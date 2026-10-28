package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNamesRejectFlagsAndSeparators(t *testing.T) {
	for _, ok := range []string{"web-1", "my_vol.data"} {
		if !validName(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"-rf", ".hidden", "a b", "a;b", ""} {
		if validName(bad) {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestRefsAllowRegistryPathsAndDigests(t *testing.T) {
	for _, ok := range []string{"postgres:17-alpine", "ghcr.io/org/app:1.2", "app@sha256:abcdef", "desktop-linux/desktop-linux/0mz8"} {
		if !validRef(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"--privileged", "a b", "a&b"} {
		if validRef(bad) {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestPortMapsNeedTwoNumbers(t *testing.T) {
	for _, ok := range []string{"8080:80", "5353:53/udp"} {
		if !validPortMap(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"8080", "8080:80:1", "a:80", "123456:80"} {
		if validPortMap(bad) {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestEnvVolumeAndCommandParsing(t *testing.T) {
	for _, ok := range []string{"DB_URL=postgres://u:p@h/db", "EMPTY="} {
		if !validEnv(ok) {
			t.Errorf("env %q should be valid", ok)
		}
	}
	for _, bad := range []string{"1BAD=x", "NOEQUALS", "A B=x"} {
		if validEnv(bad) {
			t.Errorf("env %q should be refused", bad)
		}
	}
	for _, ok := range []string{"data:/var/lib/data", "data:/var/lib/data:ro", `C:\Users\me\app:/app`, `C:\Users\me\app:/app:rw`} {
		if !validVolume(ok) {
			t.Errorf("volume %q should be valid", ok)
		}
	}
	for _, bad := range []string{"data", "data:relative", "-v:/x"} {
		if validVolume(bad) {
			t.Errorf("volume %q should be refused", bad)
		}
	}
	got, err := splitCommand(`sh -c "echo hi there" 'a b'`)
	if err != nil || !reflect.DeepEqual(got, []string{"sh", "-c", "echo hi there", "a b"}) {
		t.Errorf("splitCommand = %v, %v", got, err)
	}
	if got, _ := splitCommand("  "); len(got) != 0 {
		t.Errorf("blank command = %v", got)
	}
	if _, err := splitCommand(`echo "oops`); err == nil {
		t.Error("unclosed quote must fail")
	}
}

func TestRunArgsAreAssembledInOrder(t *testing.T) {
	o := RunOptions{
		Image: "nginx:latest", Name: "web", Ports: []string{"8080:80", " "}, Env: []string{"A=1"},
		Volumes: []string{"data:/d:ro"}, Restart: "unless-stopped", Command: "nginx -g 'daemon off;'",
	}
	want := []string{"run", "-d", "--name", "web", "-p", "8080:80", "-e", "A=1", "-v", "data:/d:ro", "--restart", "unless-stopped", "nginx:latest", "nginx", "-g", "daemon off;"}
	got, err := runArgs(o)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("runArgs = %v, %v", got, err)
	}
	for _, bad := range []RunOptions{
		{Image: "x", Ports: []string{"nope"}},
		{Image: "--privileged"},
		{Image: "x", Restart: "sometimes"},
	} {
		if _, err := runArgs(bad); err == nil {
			t.Errorf("%+v should be refused", bad)
		}
	}
}

func TestContainerPathsMustBeAbsoluteAndClean(t *testing.T) {
	for _, ok := range []string{"/var/log", "/"} {
		if !validContainerPath(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"var/log", "/a\nb", "--help"} {
		if validContainerPath(bad) {
			t.Errorf("%q should be refused", bad)
		}
	}
	if _, err := containerLs("web", "relative"); err == nil {
		t.Error("relative path must fail")
	}
	if _, err := containerLs("-x", "/"); err == nil {
		t.Error("flag-like container must fail")
	}
	if _, err := containerCopyIn("web", `Z:\definitely\missing`, "/tmp"); err == nil {
		t.Error("missing source must fail")
	}
	if _, err := containerCopyOut("web", "/etc", `Z:\definitely\missing`); err == nil {
		t.Error("missing destination must fail")
	}
}

func TestSaveAndLoadPathsAreChecked(t *testing.T) {
	tmp := os.TempDir()
	ok := filepath.Join(tmp, "export-test.tar")
	if _, err := validateSavePath(ok); err != nil {
		t.Errorf("save path: %v", err)
	}
	for _, bad := range []string{filepath.Join(tmp, "export-test.txt"), `Z:\definitely\missing\x.tar`, "x.tar"} {
		if _, err := validateSavePath(bad); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
	if _, err := validateArchivePath(`Z:\definitely\missing.tar`); err == nil {
		t.Error("missing archive must fail")
	}
	if _, err := streamCommand("save", "app:1", "x.txt", 1, false, ""); err == nil {
		t.Error("non-tar export must fail")
	}
	if _, err := streamCommand("load", "", `Z:\missing.tar`, 1, false, ""); err == nil {
		t.Error("missing archive must fail")
	}
	if _, err := streamCommand("save", "--bad", ok, 1, false, ""); err == nil {
		t.Error("flag-like image must fail")
	}
}

func TestHelperImagesAreFoundByTagOrDigest(t *testing.T) {
	digest := "sha256:c6b073f8e9e58d881f6ffba6ebf3b9ebd60b9e7d6e8337018c0e68bb5c356873"
	if ref, ok := pickHelper("postgres|17|<none>\nalpine|3|<none>\n"); !ok || ref != "alpine:3" {
		t.Errorf("tagged: %q %v", ref, ok)
	}
	if ref, ok := pickHelper("postgres|17|<none>\nalpine|<none>|" + digest + "\n"); !ok || ref != "alpine@"+digest {
		t.Errorf("pinned: %q %v", ref, ok)
	}
	for _, none := range []string{"alpine|<none>|<none>\npostgres|17|<none>", "evil/alpine-clone|1|<none>", ""} {
		if ref, ok := pickHelper(none); ok {
			t.Errorf("%q should find nothing, got %q", none, ref)
		}
	}
	if _, err := volumeRunArgs("data", "alpine@"+digest, "ls", []string{"-la"}, "/"); err != nil {
		t.Errorf("digest reference should be accepted: %v", err)
	}
}

func TestVolumeBrowsingIsReadOnlyAndConfined(t *testing.T) {
	for _, ok := range []string{"alpine:3", "docker.io/library/busybox:latest"} {
		if !isHelperImage(ok) {
			t.Errorf("%q should be a helper", ok)
		}
	}
	for _, bad := range []string{"postgres:17", "evil/alpine-clone:1"} {
		if isHelperImage(bad) {
			t.Errorf("%q must not be a helper", bad)
		}
	}
	a, err := volumeRunArgs("data", "alpine:3", "ls", []string{"-la"}, "/sub dir")
	if err != nil {
		t.Fatal(err)
	}
	joined := " " + strings.Join(a, " ") + " "
	for _, want := range []string{" data:/v:ro ", " --network none ", " --cap-drop ALL ", " --read-only ", " --rm "} {
		if !strings.Contains(joined, want) {
			t.Errorf("args missing %q: %v", want, a)
		}
	}
	if !reflect.DeepEqual(a[len(a)-2:], []string{"--", "/v/sub dir"}) {
		t.Errorf("tail = %v", a[len(a)-2:])
	}
	root, _ := volumeRunArgs("data", "alpine:3", "ls", []string{"-la"}, "/")
	if root[len(root)-1] != "/v" {
		t.Errorf("root target = %q", root[len(root)-1])
	}
	for _, bad := range [][3]string{{"data", "alpine:3", "/../etc"}, {"data", "alpine:3", "/a/../../b"}, {"data", "alpine:3", "relative"}, {"data", "postgres:17", "/"}, {"-v", "alpine:3", "/"}} {
		if _, err := volumeRunArgs(bad[0], bad[1], "ls", nil, bad[2]); err == nil {
			t.Errorf("%v should be refused", bad)
		}
	}
	if _, err := volumeRead("data", "alpine:3", "/"); err == nil {
		t.Error("reading the root must fail")
	}
}

func TestActionsAreWhitelisted(t *testing.T) {
	if _, err := composeProjectAction("web", "rm"); err == nil {
		t.Error("rm must be refused")
	}
	if _, err := composeProjectAction("--all", "stop"); err == nil {
		t.Error("flag-like project must be refused")
	}
	if _, err := composeProjectAction("a b", "stop"); err == nil {
		t.Error("project with space must be refused")
	}
	if _, err := containerAction("web", "rm -rf"); err == nil {
		t.Error("unknown action must be refused")
	}
	if _, err := containerAction("-x", "start"); err == nil {
		t.Error("flag-like container must be refused")
	}
	if _, err := inspect("network", "x"); err == nil {
		t.Error("unsupported inspect kind must be refused")
	}
	if _, err := pruneKind("everything"); err == nil {
		t.Error("unknown prune kind must be refused")
	}
}

func TestShellArgsRejectInjection(t *testing.T) {
	for _, bad := range []string{"--privileged", "web;rm"} {
		if _, err := shellArgs(bad); err == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
	if a, err := shellArgs("web-1"); err != nil || a[2] != "web-1" {
		t.Errorf("shellArgs = %v, %v", a, err)
	}
}

func TestHungCommandsAreKilledAtTheDeadline(t *testing.T) {
	// `docker` exists or not, neither may hang the caller past the deadline.
	start := time.Now()
	_, _ = outputOf(dockerCmd("events"), 300*time.Millisecond, "Docker", "Docker CLI")
	if time.Since(start) > 5*time.Second {
		t.Errorf("took %v", time.Since(start))
	}
}

func TestStreamRejectsUnknownKindAndBadDir(t *testing.T) {
	if _, err := streamCommand("exec", "x", "", 500, true, ""); err == nil {
		t.Error("unknown kind must fail")
	}
	if _, err := streamCommand("build", "t", `Z:\definitely\missing`, 500, true, ""); err == nil {
		t.Error("missing build dir must fail")
	}
	if _, err := streamCommand("logs", "web", "", 500, true, "now; calc"); err == nil {
		t.Error("bad since must fail")
	}
}

func TestSinceAcceptsOnlyTimestamps(t *testing.T) {
	for _, ok := range []string{"2026-10-21T22:00:00.123Z", "2026-10-21T22:00:00+02:00"} {
		if !validSince(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "--follow", "1h ago"} {
		if validSince(bad) {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestEngineConfigMustBeAJSONObject(t *testing.T) {
	if s, err := normalizeEngineConfig("  "); err != nil || s != "{}\n" {
		t.Errorf("blank = %q, %v", s, err)
	}
	if s, err := normalizeEngineConfig(`{"debug":true}`); err != nil || !strings.Contains(s, `"debug": true`) {
		t.Errorf("object = %q, %v", s, err)
	}
	for _, bad := range []string{"[1]", "{oops"} {
		if _, err := normalizeEngineConfig(bad); err == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
}

func TestDockerPathMustBeADockerFile(t *testing.T) {
	if err := setDockerPath(`Z:\missing\docker.exe`); err == nil {
		t.Error("missing path must fail")
	}
	if err := setDockerPath("   "); err != nil {
		t.Errorf("blank clears: %v", err)
	}
}

func TestDockerPathRefusesScriptsAndLookalikes(t *testing.T) {
	dir := t.TempDir()
	create := func(name string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, nil, 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	if _, err := checkDockerPath(create(exeName("docker"))); err != nil {
		t.Errorf("good name refused: %v", err)
	}
	for _, bad := range []string{"docker.bat", "docker.cmd", "docker.ps1", "docker.exe.txt", "mydocker.exe", "docker-compose.exe", "notdocker"} {
		if _, err := checkDockerPath(create(bad)); err == nil {
			t.Errorf("%s must be refused", bad)
		}
	}
	if _, err := checkDockerPath(dir); err == nil {
		t.Error("a folder is not a program")
	}
}
