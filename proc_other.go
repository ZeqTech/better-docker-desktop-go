//go:build !windows

package main

import "os/exec"

func hideWindow(cmd *exec.Cmd) {}

func detach(cmd *exec.Cmd) {}
