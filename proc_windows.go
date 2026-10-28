//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

const (
	createNoWindow       = 0x08000000
	detachedProcess      = 0x00000008
	createNewProcessGrp  = 0x00000200
)

// hideWindow stops a console window from flashing up for every CLI call.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// detach lets a started program outlive this window.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | createNewProcessGrp}
}
