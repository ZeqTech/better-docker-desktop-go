package main

import "testing"

func TestContextsAllowCloudNamesButNotFlags(t *testing.T) {
	for _, ok := range []string{"arn:aws:eks:us-east-1:123:cluster/prod", "do-nyc3-prod"} {
		if !validContext(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"--kubeconfig=x", "a b", ""} {
		if validContext(bad) {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestObjectsRejectFlagsAndSeparators(t *testing.T) {
	if !validObject("kube-system") {
		t.Error("kube-system should be valid")
	}
	for _, bad := range []string{"-A", "a/b", "a;b"} {
		if validObject(bad) {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestUnknownKindsAreRefused(t *testing.T) {
	if _, err := kubeGet("ctx", "secrets", ""); err == nil {
		t.Error("secrets must be refused")
	}
	if _, err := kubeShow("ctx", "yaml", "secrets", "x", "default"); err == nil {
		t.Error("secrets must be refused")
	}
}

func TestMetricsOnlyForPodsAndNodes(t *testing.T) {
	if _, err := kubeMetrics("ctx", "secrets"); err == nil {
		t.Error("secrets must be refused")
	}
	if _, err := kubeMetrics("--x", "pods"); err == nil {
		t.Error("flag-like context must be refused")
	}
}

func TestKubeShellArgsPinContextAndContainer(t *testing.T) {
	a, err := kubeShellArgs("ctx", "default", "web-1", "app")
	if err != nil || a[0] != "--context=ctx" {
		t.Fatalf("args = %v, %v", a, err)
	}
	if !inList(a, "--container=app") {
		t.Errorf("container not pinned: %v", a)
	}
	if _, err := kubeShellArgs("ctx", "default", "-x", "app"); err == nil {
		t.Error("flag-like pod must be refused")
	}
}

func TestLogTargetNeedsThreeParts(t *testing.T) {
	if _, err := kubeLogsCommand("ctx", "default/web", 10, true); err == nil {
		t.Error("two parts must fail")
	}
	if _, err := kubeLogsCommand("ctx", "default/web/app/x", 10, true); err == nil {
		t.Error("four parts must fail")
	}
	if _, err := kubeLogsCommand("ctx", "default/web/app", 10, true); err != nil {
		t.Errorf("three parts: %v", err)
	}
}

func TestKubeActionsAreRestrictedByKind(t *testing.T) {
	for _, c := range [][4]string{
		{"restart", "pods", "x", "default"},
		{"scale=2", "services", "x", "default"},
		{"scale=99999", "deployments", "x", "default"},
		{"cordon", "pods", "x", ""},
	} {
		if _, err := kubeAct("ctx", c[0], c[1], c[2], c[3]); err == nil {
			t.Errorf("%v must be refused", c)
		}
	}
}
