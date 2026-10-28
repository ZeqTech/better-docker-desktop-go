package main

// Docker CLI wrapper. Arguments are always passed as an argv list, never through a shell,
// and every user-supplied name is validated first.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode"
)

// DockerStatus is what the sidebar and status bar show.
type DockerStatus struct {
	DockerVersion *string `json:"docker_version"`
	Context       *string `json:"context"`
	DaemonRunning bool    `json:"daemon_running"`
	Error         *string `json:"error"`
}

// A wedged engine makes the CLI hang rather than fail, so every call has a deadline.
const (
	cliTimeout    = 90 * time.Second
	statusTimeout = 8 * time.Second
)

var (
	dockerPathMu sync.Mutex
	dockerPath   string // chosen in Settings; empty means "docker" from PATH
)

func exeName(base string) string {
	if runtime.GOOS == "windows" {
		return base + ".exe"
	}
	return base
}

// checkDockerPath accepts only an existing file called docker.exe (Windows) or docker (elsewhere).
// Scripts such as docker.bat or docker.cmd are refused: the app runs this path directly.
func checkDockerPath(path string) (string, error) {
	p := strings.TrimSpace(path)
	expected := exeName("docker")
	name := filepath.Base(p)
	nameOK := name == expected
	if runtime.GOOS == "windows" {
		nameOK = strings.EqualFold(name, expected)
	}
	if st, err := os.Stat(p); !nameOK || err != nil || !st.Mode().IsRegular() {
		return "", fmt.Errorf("%s must be an existing %s executable", p, expected)
	}
	return p, nil
}

// setDockerPath sets (or with an empty string, clears) the Docker CLI to use.
func setDockerPath(path string) error {
	next := ""
	if strings.TrimSpace(path) != "" {
		p, err := checkDockerPath(path)
		if err != nil {
			return err
		}
		next = p
	}
	dockerPathMu.Lock()
	dockerPath = next
	dockerPathMu.Unlock()
	return nil
}

// dockerProgram is the docker executable to run: the one chosen in Settings, else `docker` from PATH.
func dockerProgram() string {
	dockerPathMu.Lock()
	p := dockerPath
	dockerPathMu.Unlock()
	if p != "" {
		return p
	}
	return findTool(exeName("docker"))
}

// findTool resolves a tool to an absolute path by searching PATH, falling back to the bare name.
func findTool(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return name
}

// fixPath adds the usual install locations to PATH on macOS and Linux, where a GUI launch
// inherits a minimal PATH. Windows needs nothing.
func fixPath() {
	if runtime.GOOS == "windows" {
		return
	}
	dirs := filepath.SplitList(os.Getenv("PATH"))
	have := map[string]bool{}
	for _, d := range dirs {
		have[d] = true
	}
	extra := []string{"/usr/local/bin", "/opt/homebrew/bin", "/Applications/Docker.app/Contents/Resources/bin"}
	if home, err := os.UserHomeDir(); err == nil {
		extra = append(extra, filepath.Join(home, ".docker/bin"), filepath.Join(home, ".rd/bin"), filepath.Join(home, "google-cloud-sdk/bin"))
	}
	extra = append(extra, "/opt/homebrew/share/google-cloud-sdk/bin", "/usr/local/share/google-cloud-sdk/bin")
	for _, d := range extra {
		if st, err := os.Stat(d); err == nil && st.IsDir() && !have[d] {
			dirs = append(dirs, d)
		}
	}
	_ = os.Setenv("PATH", strings.Join(dirs, string(filepath.ListSeparator)))
}

// shellArgs is argv for an interactive shell in a container: bash when present, else sh.
func shellArgs(container string) ([]string, error) {
	c, err := nameArg(container)
	if err != nil {
		return nil, err
	}
	return []string{"exec", "-it", c, "sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"}, nil
}

func dockerCmd(args ...string) *exec.Cmd {
	cmd := exec.Command(dockerProgram(), args...)
	hideWindow(cmd)
	return cmd
}

// cmdOutput is stdout and stderr of a finished command.
type cmdOutput struct {
	stdout, stderr []byte
	ok             bool
}

// outputOf runs a prepared command with a deadline, capturing both pipes. `who` names the tool in
// the timeout message and `cli` in the "not found" message.
func outputOf(cmd *exec.Cmd, limit time.Duration, who, cli string) (cmdOutput, error) {
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()
	var out, errb bytes.Buffer
	cmd.Stdin = nil
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Start(); err != nil {
		return cmdOutput{}, fmt.Errorf("%s not found: %v (tried \"%s\"; PATH=%s)", cli, err, cmd.Path, os.Getenv("PATH"))
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		var ee *exec.ExitError
		ok := err == nil
		if err != nil && !errors.As(err, &ee) {
			return cmdOutput{}, err
		}
		return cmdOutput{stdout: out.Bytes(), stderr: errb.Bytes(), ok: ok}, nil
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		<-done
		if who == "Docker" {
			return cmdOutput{}, fmt.Errorf("Docker did not respond within %ds. The engine may be stuck; restart Docker Desktop.", int(limit.Seconds()))
		}
		return cmdOutput{}, fmt.Errorf("%s did not respond within %ds.", who, int(limit.Seconds()))
	}
}

func text(b []byte) string { return strings.TrimSpace(strings.ToValidUTF8(string(b), "�")) }

// run executes `docker <args>`; the result is trimmed stdout, the error trimmed stderr (or stdout if stderr is empty).
func run(args ...string) (string, error) {
	o, err := outputOf(dockerCmd(args...), cliTimeout, "Docker", "Docker CLI")
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

func dockerStatus() DockerStatus {
	var s DockerStatus
	if o, err := outputOf(dockerCmd("context", "show"), statusTimeout, "Docker", "Docker CLI"); err == nil && o.ok {
		v := text(o.stdout)
		s.Context = &v
	}
	o, err := outputOf(dockerCmd("version", "--format", "{{.Server.Version}}"), statusTimeout, "Docker", "Docker CLI")
	switch {
	case err != nil:
		e := err.Error()
		s.Error = &e
	case o.ok:
		v := text(o.stdout)
		s.DockerVersion = &v
		s.DaemonRunning = true
	default:
		e := text(o.stderr)
		s.Error = &e
	}
	return s
}

// ---- validation -------------------------------------------------------------------------

func isAlnum(r rune) bool { return r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r)) }

// validName covers container / volume names and short IDs.
func validName(name string) bool {
	if name == "" || len(name) > 255 || name[0] == '-' || name[0] == '.' {
		return false
	}
	for _, r := range name {
		if !isAlnum(r) && r != '-' && r != '_' && r != '.' {
			return false
		}
	}
	return true
}

// validRef covers image references: `repo/name:tag`, `name@sha256:...`, IDs and build refs.
func validRef(r string) bool {
	if r == "" || len(r) > 512 || r[0] == '-' {
		return false
	}
	for _, c := range r {
		if !isAlnum(c) && !strings.ContainsRune("-_./:@", c) {
			return false
		}
	}
	return true
}

// validSince is an RFC 3339 timestamp such as `2026-10-21T22:00:00.123Z`.
func validSince(s string) bool {
	if s == "" || len(s) > 40 || s[0] < '0' || s[0] > '9' {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9') && !strings.ContainsRune("-:.TZ+", c) {
			return false
		}
	}
	return true
}

// validPortMap is `host:container`, e.g. `8080:80` or `5353:53/udp`.
func validPortMap(p string) bool {
	p = strings.TrimSuffix(strings.TrimSuffix(p, "/tcp"), "/udp")
	parts := strings.Split(p, ":")
	if len(parts) != 2 {
		return false
	}
	for _, s := range parts {
		if s == "" || len(s) > 5 {
			return false
		}
		for _, c := range s {
			if c < '0' || c > '9' {
				return false
			}
		}
	}
	return true
}

func nameArg(name string) (string, error) {
	if validName(name) {
		return name, nil
	}
	return "", fmt.Errorf("invalid name: %s", name)
}

func refArg(r string) (string, error) {
	if validRef(r) {
		return r, nil
	}
	return "", fmt.Errorf("invalid reference: %s", r)
}

// validateDir returns the absolute form of an existing directory.
func validateDir(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("%s: %v", path, err)
	}
	st, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("%s: %v", path, err)
	}
	if !st.IsDir() {
		return "", fmt.Errorf("%s is not a folder", path)
	}
	return abs, nil
}

func hostPathExists(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", fmt.Errorf("%s: %v", p, err)
	}
	if _, err := os.Stat(abs); err != nil {
		return "", fmt.Errorf("%s: %v", p, err)
	}
	return abs, nil
}

// ---- listings (raw JSON lines; parsed in the frontend) ----------------------------------

func listContainers() (string, error) {
	return run("ps", "-a", "--no-trunc", "--format", "{{json .}}")
}

// containersUsingVolume lists containers (running or not) that mount the named volume, as JSON lines.
func containersUsingVolume(name string) (string, error) {
	n, err := nameArg(name)
	if err != nil {
		return "", err
	}
	return run("ps", "-a", "--no-trunc", "--filter", "volume="+n, "--format", "{{json .}}")
}

func containerStats() (string, error) { return run("stats", "--no-stream", "--format", "{{json .}}") }

func listImages() (string, error) { return run("images", "--no-trunc", "--format", "{{json .}}") }

// diskUsage is `system df -v` as one JSON object: Images, Containers, Volumes (with sizes), BuildCache.
func diskUsage() (string, error) { return run("system", "df", "-v", "--format", "{{json .}}") }

// imageHistory lists the layers of an image, newest first, as JSON lines.
func imageHistory(image string) (string, error) {
	r, err := refArg(image)
	if err != nil {
		return "", err
	}
	return run("history", "--no-trunc", "--format", "{{json .}}", r)
}

// buildHistory needs buildx 0.20+. An old buildx yields an error the UI shows as a hint.
func buildHistory() (string, error) { return run("buildx", "history", "ls", "--format", "json") }

// validateSavePath checks a file path for `docker save`: its folder must exist and the name must end in `.tar`.
func validateSavePath(path string) (string, error) {
	name := filepath.Base(path)
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "", errors.New("choose a file name")
	}
	if !strings.HasSuffix(strings.ToLower(name), ".tar") {
		return "", errors.New("the export file must end in .tar")
	}
	parent := filepath.Dir(path)
	if parent == "." && !strings.ContainsAny(path, `/\`) {
		return "", errors.New("choose a folder for the file")
	}
	dir, err := validateDir(parent)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, name), nil
}

// validateArchivePath checks an existing image archive for `docker load`.
func validateArchivePath(path string) (string, error) {
	abs, err := hostPathExists(path)
	if err != nil {
		return "", err
	}
	lower := strings.ToLower(abs)
	if st, err := os.Stat(abs); err != nil || !st.Mode().IsRegular() ||
		!(strings.HasSuffix(lower, ".tar") || strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz")) {
		return "", errors.New("choose a .tar, .tar.gz or .tgz image archive")
	}
	return abs, nil
}

// ---- engine configuration (daemon.json) ---------------------------------------------------

// EngineConfig is the Docker daemon.json as shown in Settings.
type EngineConfig struct {
	Path    string `json:"path"`
	Exists  bool   `json:"exists"`
	Content string `json:"content"`
}

func daemonJSONPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", errors.New("cannot find the home folder")
	}
	return filepath.Join(home, ".docker", "daemon.json"), nil
}

// normalizeEngineConfig parses and re-formats engine config. It must be a JSON object; blank means `{}`.
func normalizeEngineConfig(s string) (string, error) {
	if strings.TrimSpace(s) == "" {
		return "{}\n", nil
	}
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return "", fmt.Errorf("invalid JSON: %v", err)
	}
	if _, ok := v.(map[string]any); !ok {
		return "", errors.New("the engine config must be a JSON object")
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func readEngineConfig() (EngineConfig, error) {
	path, err := daemonJSONPath()
	if err != nil {
		return EngineConfig{}, err
	}
	st, err := os.Stat(path)
	switch {
	case err == nil && st.Size() > 1_000_000:
		return EngineConfig{}, fmt.Errorf("%s is too large", path)
	case err == nil:
		b, err := os.ReadFile(path)
		if err != nil {
			return EngineConfig{}, err
		}
		return EngineConfig{Path: path, Exists: true, Content: string(b)}, nil
	case errors.Is(err, os.ErrNotExist):
		return EngineConfig{Path: path, Exists: false, Content: "{}\n"}, nil
	default:
		return EngineConfig{}, err
	}
}

// writeEngineConfig validates, backs up the old file to `daemon.json.bak`, then replaces it atomically.
func writeEngineConfig(s string) (string, error) {
	normalized, err := normalizeEngineConfig(s)
	if err != nil {
		return "", err
	}
	path, err := daemonJSONPath()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if old, err := os.ReadFile(path); err == nil {
		if err := os.WriteFile(strings.TrimSuffix(path, ".json")+".json.bak", old, 0o644); err != nil {
			return "", fmt.Errorf("backup failed: %v", err)
		}
	}
	tmp := strings.TrimSuffix(path, ".json") + ".json.tmp"
	if err := os.WriteFile(tmp, []byte(normalized), 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return normalized, nil
}

// ---- volume contents (read-only) ----------------------------------------------------------

// isHelperImage reports whether the image is one of the tiny images used to read a volume.
func isHelperImage(image string) bool {
	repo := image
	if i := strings.IndexAny(repo, ":@"); i >= 0 {
		repo = repo[:i]
	}
	if i := strings.LastIndex(repo, "/"); i >= 0 {
		repo = repo[i+1:]
	}
	return repo == "alpine" || repo == "busybox"
}

// pickHelper picks a usable helper reference from `docker images` lines of `repository|tag|digest`.
func pickHelper(listing string) (string, bool) {
	for _, line := range strings.Split(listing, "\n") {
		f := strings.Split(strings.TrimRight(line, "\r"), "|")
		if len(f) < 2 {
			continue
		}
		repo, tag, digest := f[0], f[1], ""
		if len(f) > 2 {
			digest = f[2]
		}
		if !isHelperImage(repo) || strings.Contains(repo, "<none>") {
			continue
		}
		var ref string
		switch {
		case tag != "<none>" && tag != "":
			ref = repo + ":" + tag
		case strings.HasPrefix(digest, "sha256:"):
			ref = repo + "@" + digest
		default:
			continue
		}
		if validRef(ref) {
			return ref, true
		}
	}
	return "", false
}

// volumeHelperImage finds a local alpine or busybox image to read volumes with. It never pulls.
func volumeHelperImage() (*string, error) {
	out, err := run("images", "--digests", "--format", "{{.Repository}}|{{.Tag}}|{{.Digest}}")
	if err != nil {
		return nil, err
	}
	if ref, ok := pickHelper(out); ok {
		return &ref, nil
	}
	return nil, nil
}

// validContainerPath is an absolute path inside a container with no control characters.
func validContainerPath(p string) bool {
	if !strings.HasPrefix(p, "/") || len(p) > 4096 {
		return false
	}
	for _, r := range p {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// validVolumePath is a path inside the volume: absolute, no control characters and no `..` segments.
func validVolumePath(p string) bool {
	if !validContainerPath(p) {
		return false
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return false
		}
	}
	return true
}

// volumeRunArgs is argv for a throwaway container that runs `program` on a path inside the volume.
// The volume is mounted read-only and the container has no network, no capabilities and a read-only root.
func volumeRunArgs(volume, image, program string, toolArgs []string, path string) ([]string, error) {
	v, err := nameArg(volume)
	if err != nil {
		return nil, err
	}
	if !isHelperImage(image) || !validRef(image) {
		return nil, fmt.Errorf("%s is not a supported helper image (alpine or busybox)", image)
	}
	if !validVolumePath(path) {
		return nil, fmt.Errorf("invalid path: %s", path)
	}
	target := "/v"
	if path != "/" {
		target += path
	}
	a := []string{
		"run", "--rm", "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
		"--read-only", "--pids-limit", "32", "--memory", "64m",
		"-v", v + ":/v:ro", "--entrypoint", program, image,
	}
	a = append(a, toolArgs...)
	return append(a, "--", target), nil
}

// volumeLs is `ls -la` of a folder inside a volume.
func volumeLs(volume, image, path string) (string, error) {
	a, err := volumeRunArgs(volume, image, "ls", []string{"-la"}, path)
	if err != nil {
		return "", err
	}
	return run(a...)
}

// volumeRead returns at most the first 64 KiB of a file inside a volume.
func volumeRead(volume, image, path string) (string, error) {
	if path == "/" {
		return "", errors.New("choose a file")
	}
	a, err := volumeRunArgs(volume, image, "head", []string{"-c", "65536"}, path)
	if err != nil {
		return "", err
	}
	return run(a...)
}

// ---- container files ------------------------------------------------------------------------

func containerPath(p string) (string, error) {
	if validContainerPath(p) {
		return p, nil
	}
	return "", fmt.Errorf("invalid container path: %s", p)
}

// containerLs is `ls -la` of a directory inside a running container.
func containerLs(container, path string) (string, error) {
	c, err := nameArg(container)
	if err != nil {
		return "", err
	}
	p, err := containerPath(path)
	if err != nil {
		return "", err
	}
	return run("exec", c, "ls", "-la", "--", p)
}

// containerCopyOut copies `path` out of the container into the existing host folder `destDir`.
func containerCopyOut(container, path, destDir string) (string, error) {
	c, err := nameArg(container)
	if err != nil {
		return "", err
	}
	p, err := containerPath(path)
	if err != nil {
		return "", err
	}
	dest, err := validateDir(destDir)
	if err != nil {
		return "", err
	}
	if _, err := run("cp", c+":"+p, dest); err != nil {
		return "", err
	}
	return "Copied to " + dest, nil
}

// containerCopyIn copies a host file or folder into the container directory `destDir`.
func containerCopyIn(container, src, destDir string) (string, error) {
	host, err := hostPathExists(src)
	if err != nil {
		return "", err
	}
	c, err := nameArg(container)
	if err != nil {
		return "", err
	}
	p, err := containerPath(destDir)
	if err != nil {
		return "", err
	}
	if _, err := run("cp", host, c+":"+strings.TrimRight(p, "/")+"/"); err != nil {
		return "", err
	}
	return "Copied into " + destDir, nil
}

// ---- inspect and actions ------------------------------------------------------------------

func inspect(kind, target string) (string, error) {
	switch kind {
	case "container", "image", "volume":
	default:
		return "", fmt.Errorf("cannot inspect %s", kind)
	}
	var t string
	var err error
	if kind == "volume" {
		t, err = nameArg(target)
	} else {
		t, err = refArg(target)
	}
	if err != nil {
		return "", err
	}
	return run(kind, "inspect", t)
}

func containerAction(id, action string) (string, error) {
	n, err := nameArg(id)
	if err != nil {
		return "", err
	}
	switch action {
	case "start", "stop", "restart", "pause", "unpause", "kill":
		return run(action, n)
	case "remove":
		return run("rm", "-f", n)
	}
	return "", fmt.Errorf("unknown action: %s", action)
}

// composeProjectAction starts, stops, restarts or takes down a whole Compose project by name (no
// compose file needed: Compose finds the project's containers through their labels). `down`
// removes containers and networks but keeps named volumes.
func composeProjectAction(project, action string) (string, error) {
	p, err := nameArg(project)
	if err != nil {
		return "", err
	}
	switch action {
	case "start", "stop", "restart", "down":
		return run("compose", "-p", p, action)
	}
	return "", fmt.Errorf("unknown project action: %s", action)
}

func imageRemove(image string, force bool) (string, error) {
	r, err := refArg(image)
	if err != nil {
		return "", err
	}
	if force {
		return run("rmi", "-f", r)
	}
	return run("rmi", r)
}

func imageTag(source, target string) (string, error) {
	s, err := refArg(source)
	if err != nil {
		return "", err
	}
	t, err := refArg(target)
	if err != nil {
		return "", err
	}
	return run("tag", s, t)
}

// RunOptions is everything the Run dialog can set. Lists hold one entry per line the user typed.
type RunOptions struct {
	Image   string   `json:"image"`
	Name    string   `json:"name"`
	Ports   []string `json:"ports"`
	Env     []string `json:"env"`
	Volumes []string `json:"volumes"`
	Restart string   `json:"restart"`
	Command string   `json:"command"`
}

// validEnv is `KEY=VALUE` with a conventional variable name.
func validEnv(e string) bool {
	k, v, ok := strings.Cut(e, "=")
	if !ok || k == "" || (k[0] >= '0' && k[0] <= '9') || strings.ContainsAny(v, "\n\r\x00") {
		return false
	}
	for _, c := range k {
		if !isAlnum(c) && c != '_' {
			return false
		}
	}
	return true
}

// validVolume is `src:dst[:ro|rw]`. `src` is a volume name or a host path (it may contain a Windows drive colon).
func validVolume(v string) bool {
	if strings.ContainsAny(v, "\n\r\x00") {
		return false
	}
	parts := strings.Split(v, ":")
	if last := parts[len(parts)-1]; last == "ro" || last == "rw" {
		parts = parts[:len(parts)-1]
	}
	if len(parts) == 0 {
		return false
	}
	dst := parts[len(parts)-1]
	src := strings.Join(parts[:len(parts)-1], ":")
	return strings.HasPrefix(dst, "/") && len(dst) > 1 && src != "" && !strings.HasPrefix(src, "-")
}

// splitCommand splits a command line on whitespace, honouring single and double quotes.
func splitCommand(s string) ([]string, error) {
	var out []string
	var cur strings.Builder
	var quote rune
	has := false
	for _, c := range s {
		switch {
		case quote != 0 && c == quote:
			quote = 0
		case quote != 0:
			cur.WriteRune(c)
		case c == '"' || c == '\'':
			quote = c
			has = true
		case unicode.IsSpace(c):
			if has || cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
				has = false
			}
		default:
			cur.WriteRune(c)
		}
	}
	if quote != 0 {
		return nil, errors.New("unclosed quote in the command")
	}
	if has || cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out, nil
}

// runArgs is the full argv (after `docker`) for a validated run request.
func runArgs(o RunOptions) ([]string, error) {
	a := []string{"run", "-d"}
	if _, err := refArg(o.Image); err != nil {
		return nil, err
	}
	if n := strings.TrimSpace(o.Name); n != "" {
		if _, err := nameArg(n); err != nil {
			return nil, err
		}
		a = append(a, "--name", n)
	}
	for _, p := range o.Ports {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		if !validPortMap(p) {
			return nil, fmt.Errorf("invalid port mapping: %s (use host:container, e.g. 8080:80)", p)
		}
		a = append(a, "-p", p)
	}
	for _, e := range o.Env {
		if e = strings.TrimSpace(e); e == "" {
			continue
		}
		if !validEnv(e) {
			return nil, fmt.Errorf("invalid environment variable: %s (use KEY=VALUE)", e)
		}
		a = append(a, "-e", e)
	}
	for _, v := range o.Volumes {
		if v = strings.TrimSpace(v); v == "" {
			continue
		}
		if !validVolume(v) {
			return nil, fmt.Errorf("invalid volume: %s (use name-or-path:/container/path[:ro])", v)
		}
		a = append(a, "-v", v)
	}
	switch o.Restart {
	case "", "no":
	case "always", "unless-stopped", "on-failure":
		a = append(a, "--restart", o.Restart)
	default:
		return nil, fmt.Errorf("unknown restart policy: %s", o.Restart)
	}
	a = append(a, o.Image)
	cmd, err := splitCommand(o.Command)
	if err != nil {
		return nil, err
	}
	return append(a, cmd...), nil
}

// imageRun is `docker run -d` with the options from the Run dialog.
func imageRun(o RunOptions) (string, error) {
	a, err := runArgs(o)
	if err != nil {
		return "", err
	}
	return run(a...)
}

func pruneKind(kind string) (string, error) {
	switch kind {
	case "images":
		return run("image", "prune", "-a", "-f")
	case "containers":
		return run("container", "prune", "-f")
	case "volumes":
		return run("volume", "prune", "-a", "-f")
	case "buildcache":
		return run("builder", "prune", "-a", "-f")
	}
	return "", fmt.Errorf("cannot prune %s", kind)
}

func volumeCreate(name string) (string, error) {
	n, err := nameArg(name)
	if err != nil {
		return "", err
	}
	return run("volume", "create", n)
}

func volumeRemove(name string, force bool) (string, error) {
	n, err := nameArg(name)
	if err != nil {
		return "", err
	}
	if force {
		return run("volume", "rm", "-f", n)
	}
	return run("volume", "rm", n)
}

func buildHistoryRemove(reference string) (string, error) {
	r, err := refArg(reference)
	if err != nil {
		return "", err
	}
	return run("buildx", "history", "rm", r)
}

// startEngine launches Docker Desktop (detached) so the engine comes up. It returns once the app
// is spawned, not once the engine is ready; callers poll the status.
func startEngine() (string, error) {
	switch runtime.GOOS {
	case "windows":
		var exe string
		for _, v := range []string{"ProgramFiles", "ProgramW6432", "LOCALAPPDATA"} {
			root := os.Getenv(v)
			if root == "" {
				continue
			}
			for _, rel := range []string{`Docker\Docker\Docker Desktop.exe`, `Programs\Docker\Docker\Docker Desktop.exe`} {
				if p := filepath.Join(root, rel); fileExists(p) && exe == "" {
					exe = p
				}
			}
		}
		if exe == "" {
			return "", errors.New("Docker Desktop.exe not found. Install Docker Desktop or start your engine manually.")
		}
		cmd := exec.Command(exe)
		detach(cmd)
		if err := cmd.Start(); err != nil {
			return "", fmt.Errorf("could not start %s: %v", exe, err)
		}
		go func() { _ = cmd.Wait() }()
		return "Starting " + exe, nil
	case "darwin":
		if err := exec.Command("open", "-a", "Docker").Start(); err != nil {
			return "", err
		}
		return "Starting Docker Desktop", nil
	}
	return "", errors.New("Start the Docker service yourself, e.g. `sudo systemctl start docker`.")
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Mode().IsRegular()
}

// ---- streaming commands -------------------------------------------------------------------

// eventNames are the lifecycle events shown; health checks otherwise flood the stream with exec_* events.
var eventNames = []string{
	"create", "start", "stop", "die", "destroy", "kill", "oom", "pause", "unpause", "rename", "restart",
	"health_status", "pull", "delete", "tag", "untag", "import", "load",
}

// streamCommand builds (but does not start) a long-running command. `kind` is one of `logs`
// (target = container), `pull` (target = image), `build` (target = tag, context = folder holding a
// Dockerfile), `events`, `stats`, `save` (context = destination file) or `load` (context = archive).
func streamCommand(kind, target, ctxArg string, tail int, timestamps bool, since string) (*exec.Cmd, error) {
	var args []string
	switch kind {
	case "logs":
		if tail < 1 {
			tail = 1
		} else if tail > 100_000 {
			tail = 100_000
		}
		args = []string{"logs", "-f"}
		// Re-attaching after a restart continues from a point in time instead of repeating history.
		if since == "" {
			args = append(args, "--tail", fmt.Sprint(tail))
		} else if validSince(since) {
			args = append(args, "--since", since)
		} else {
			return nil, fmt.Errorf("invalid time: %s", since)
		}
		if timestamps {
			args = append(args, "--timestamps")
		}
		n, err := nameArg(target)
		if err != nil {
			return nil, err
		}
		args = append(args, n)
	case "pull":
		r, err := refArg(target)
		if err != nil {
			return nil, err
		}
		args = []string{"pull", r}
	case "stats":
		n, err := nameArg(target)
		if err != nil {
			return nil, err
		}
		args = []string{"stats", "--format", "{{json .}}", n}
	case "save":
		file, err := validateSavePath(ctxArg)
		if err != nil {
			return nil, err
		}
		r, err := refArg(target)
		if err != nil {
			return nil, err
		}
		args = []string{"save", "-o", file, r}
	case "load":
		file, err := validateArchivePath(ctxArg)
		if err != nil {
			return nil, err
		}
		args = []string{"load", "-i", file}
	case "events":
		args = []string{"events", "--format", "{{json .}}"}
		for _, t := range []string{"container", "image", "volume"} {
			args = append(args, "--filter", "type="+t)
		}
		for _, e := range eventNames {
			args = append(args, "--filter", "event="+e)
		}
	case "build":
		dir, err := validateDir(ctxArg)
		if err != nil {
			return nil, err
		}
		if !fileExists(filepath.Join(dir, "Dockerfile")) {
			return nil, fmt.Errorf("no Dockerfile in %s", dir)
		}
		args = []string{"build", "--progress=plain"}
		if target != "" {
			r, err := refArg(target)
			if err != nil {
				return nil, err
			}
			args = append(args, "-t", r)
		}
		args = append(args, dir)
	default:
		return nil, fmt.Errorf("unknown stream: %s", kind)
	}
	return dockerCmd(args...), nil
}
