//go:build windows

package main

import (
	"strings"
	"testing"
	"time"
)

func TestConPTYRunsAProgramAndReturnsItsOutput(t *testing.T) {
	sess, err := startPTY("cmd.exe", []string{"/c", "echo", "hello-from-pty"}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Kill()

	got := make(chan string, 1)
	go func() {
		var sb strings.Builder
		buf := make([]byte, 4096)
		for {
			n, err := sess.Read(buf)
			sb.Write(buf[:n])
			if strings.Contains(sb.String(), "hello-from-pty") || err != nil {
				got <- sb.String()
				return
			}
		}
	}()
	select {
	case out := <-got:
		if !strings.Contains(out, "hello-from-pty") {
			t.Fatalf("output = %q", out)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("no output from the pseudo-terminal")
	}
	if err := sess.Resize(100, 30); err != nil && !strings.Contains(err.Error(), "closed") {
		t.Logf("resize after exit: %v", err)
	}
}
