package main

// kubectl wrapper. Same rules as docker.go: argv only, no shell, validated names. Every call
// names its context with `--context=` so the app never changes the user's kubeconfig.

import (
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// KubeStatus is the kubectl state shown in the Kubernetes navigation.
type KubeStatus struct {
	Available bool     `json:"available"`
	Contexts  []string `json:"contexts"`
	Current   *string  `json:"current"`
	Error     *string  `json:"error"`
}

const (
	kubeTimeout      = 30 * time.Second
	kubeLocalTimeout = 8 * time.Second
)

func kubeProgram() string { return findTool(exeName("kubectl")) }

func kubeCmd(args []string) *exec.Cmd {
	cmd := exec.Command(kubeProgram(), args...)
	hideWindow(cmd)
	return cmd
}

func kubeRun(args []string, limit time.Duration) (string, error) {
	o, err := outputOf(kubeCmd(args), limit, "kubectl", "kubectl")
	if err != nil {
		return "", err
	}
	if o.ok {
		return text(o.stdout), nil
	}
	msg := text(o.stderr)
	if msg == "" {
		msg = text(o.stdout)
	}
	return "", errors.New(msg)
}

// ---- validation -------------------------------------------------------------------------

// validContext allows what cloud kubeconfigs use: `:`, `/`, `@` (EKS, GKE, OpenShift).
func validContext(c string) bool {
	if c == "" || len(c) > 253 || c[0] == '-' {
		return false
	}
	for _, r := range c {
		if !isAlnum(r) && !strings.ContainsRune("-_.:/@=+", r) {
			return false
		}
	}
	return true
}

// validObject covers namespace, pod, node and similar names (DNS-1123 plus the odd uppercase or underscore).
func validObject(n string) bool {
	if n == "" || len(n) > 253 || n[0] == '-' || n[0] == '.' {
		return false
	}
	for _, r := range n {
		if !isAlnum(r) && !strings.ContainsRune("-._:", r) {
			return false
		}
	}
	return true
}

// kubeKinds are the resource kinds the app may read. Anything else is refused.
var kubeKinds = []string{
	"nodes", "namespaces", "pods", "deployments", "statefulsets", "daemonsets", "services", "events",
	"configmaps", "ingresses", "jobs", "cronjobs",
}

func inList(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func kindArg(k string) (string, error) {
	if inList(kubeKinds, k) {
		return k, nil
	}
	return "", fmt.Errorf("unsupported resource kind: %s", k)
}

func ctxArg(c string) (string, error) {
	if validContext(c) {
		return "--context=" + c, nil
	}
	return "", fmt.Errorf("invalid context: %s", c)
}

func nsArgs(ns string) ([]string, error) {
	switch {
	case ns == "":
		return []string{"--all-namespaces"}, nil
	case validObject(ns):
		return []string{"--namespace=" + ns}, nil
	}
	return nil, fmt.Errorf("invalid namespace: %s", ns)
}

func objectArg(n string) (string, error) {
	if validObject(n) {
		return n, nil
	}
	return "", fmt.Errorf("invalid name: %s", n)
}

// ---- reads ------------------------------------------------------------------------------

// kubeStatus reports kubectl and the contexts in the kubeconfig. It reads local files only, so it
// is quick even when every cluster is unreachable.
func kubeStatus() KubeStatus {
	s := KubeStatus{Contexts: []string{}}
	out, err := kubeRun([]string{"config", "get-contexts", "-o", "name"}, kubeLocalTimeout)
	if err != nil {
		e := err.Error()
		s.Available = !strings.Contains(e, "not found")
		s.Error = &e
		return s
	}
	s.Available = true
	for _, l := range strings.Split(out, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			s.Contexts = append(s.Contexts, l)
		}
	}
	if cur, err := kubeRun([]string{"config", "current-context"}, kubeLocalTimeout); err == nil && cur != "" {
		s.Current = &cur
	}
	return s
}

func isClusterScoped(kind string) bool { return kind == "nodes" || kind == "namespaces" }

// kubeGet is `kubectl get <kind> -o json` for one namespace, or all when ns is empty.
func kubeGet(context, kind, ns string) (string, error) {
	c, err := ctxArg(context)
	if err != nil {
		return "", err
	}
	k, err := kindArg(kind)
	if err != nil {
		return "", err
	}
	args := []string{c, "get", k, "-o", "json"}
	if !isClusterScoped(kind) {
		n, err := nsArgs(ns)
		if err != nil {
			return "", err
		}
		args = append(args, n...)
	}
	return kubeRun(args, kubeTimeout)
}

// kubeMetrics returns live usage from metrics-server (`pods` or `nodes`) as the raw metrics.k8s.io
// list. It fails when the cluster has no metrics-server; callers treat that as "no usage data".
func kubeMetrics(context, kind string) (string, error) {
	if kind != "pods" && kind != "nodes" {
		return "", fmt.Errorf("no metrics for %s", kind)
	}
	c, err := ctxArg(context)
	if err != nil {
		return "", err
	}
	return kubeRun([]string{c, "get", "--raw", "/apis/metrics.k8s.io/v1beta1/" + kind}, kubeTimeout)
}

// kubeShow is `describe` or `yaml` of one object.
func kubeShow(context, mode, kind, name, ns string) (string, error) {
	c, err := ctxArg(context)
	if err != nil {
		return "", err
	}
	args := []string{c}
	switch mode {
	case "describe":
		args = append(args, "describe")
	case "yaml":
		args = append(args, "get", "-o", "yaml")
	default:
		return "", fmt.Errorf("unknown view: %s", mode)
	}
	k, err := kindArg(kind)
	if err != nil {
		return "", err
	}
	n, err := objectArg(name)
	if err != nil {
		return "", err
	}
	args = append(args, k, n)
	if !isClusterScoped(kind) {
		nsName, err := objectArg(ns)
		if err != nil {
			return "", err
		}
		args = append(args, "--namespace="+nsName)
	}
	return kubeRun(args, kubeTimeout)
}

// ---- changes ----------------------------------------------------------------------------

// kubeAct is `delete`, `restart` (rollout restart), `cordon`, `uncordon` or `scale=N` on one object.
func kubeAct(context, action, kind, name, ns string) (string, error) {
	k, err := kindArg(kind)
	if err != nil {
		return "", err
	}
	c, err := ctxArg(context)
	if err != nil {
		return "", err
	}
	args := []string{c}
	target := func() ([]string, error) {
		n, err := objectArg(name)
		if err != nil {
			return nil, err
		}
		nsName, err := objectArg(ns)
		if err != nil {
			return nil, err
		}
		return []string{k + "/" + n, "--namespace=" + nsName}, nil
	}
	switch {
	case action == "delete":
		if !inList([]string{"pods", "deployments", "statefulsets", "daemonsets", "services", "jobs", "cronjobs", "configmaps", "ingresses"}, k) {
			return "", fmt.Errorf("cannot delete %s from here", k)
		}
		t, err := target()
		if err != nil {
			return "", err
		}
		args = append(args, "delete")
		args = append(args, t...)
	case action == "restart":
		if !inList([]string{"deployments", "statefulsets", "daemonsets"}, k) {
			return "", fmt.Errorf("cannot restart %s", k)
		}
		t, err := target()
		if err != nil {
			return "", err
		}
		args = append(args, "rollout", "restart")
		args = append(args, t...)
	case action == "cordon" || action == "uncordon":
		if k != "nodes" {
			return "", fmt.Errorf("cannot %s %s", action, k)
		}
		n, err := objectArg(name)
		if err != nil {
			return "", err
		}
		args = append(args, action, n)
	case strings.HasPrefix(action, "scale="):
		n, err := strconv.ParseUint(strings.TrimPrefix(action, "scale="), 10, 32)
		if err != nil {
			return "", fmt.Errorf("invalid replica count in %s", action)
		}
		if n > 1000 || !inList([]string{"deployments", "statefulsets"}, k) {
			return "", fmt.Errorf("cannot scale %s to %d", k, n)
		}
		t, err := target()
		if err != nil {
			return "", err
		}
		args = append(args, "scale", fmt.Sprintf("--replicas=%d", n))
		args = append(args, t...)
	default:
		return "", fmt.Errorf("unknown action: %s", action)
	}
	return kubeRun(args, kubeTimeout)
}

// ---- streams and shells -----------------------------------------------------------------

// kubeLogsCommand builds `kubectl logs -f` for target = `namespace/pod/container`.
func kubeLogsCommand(context, target string, tail int, timestamps bool) (*exec.Cmd, error) {
	parts := strings.Split(target, "/")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid log target: %s", target)
	}
	c, err := ctxArg(context)
	if err != nil {
		return nil, err
	}
	ns, err := objectArg(parts[0])
	if err != nil {
		return nil, err
	}
	pod, err := objectArg(parts[1])
	if err != nil {
		return nil, err
	}
	container, err := objectArg(parts[2])
	if err != nil {
		return nil, err
	}
	if tail < 1 {
		tail = 1
	} else if tail > 100_000 {
		tail = 100_000
	}
	args := []string{c, "--namespace=" + ns, "logs", "-f", fmt.Sprintf("--tail=%d", tail)}
	if timestamps {
		args = append(args, "--timestamps")
	}
	args = append(args, "--container="+container, pod)
	return kubeCmd(args), nil
}

// kubeShellArgs is argv for an interactive shell in a pod container: bash when present, else sh.
func kubeShellArgs(context, ns, pod, container string) ([]string, error) {
	c, err := ctxArg(context)
	if err != nil {
		return nil, err
	}
	n, err := objectArg(ns)
	if err != nil {
		return nil, err
	}
	p, err := objectArg(pod)
	if err != nil {
		return nil, err
	}
	ct, err := objectArg(container)
	if err != nil {
		return nil, err
	}
	return []string{c, "--namespace=" + n, "exec", "-it", p, "--container=" + ct, "--", "sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"}, nil
}
