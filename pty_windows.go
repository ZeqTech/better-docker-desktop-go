//go:build windows

package main

import (
	"context"
	"os"
	"strings"
	"sync"
	"syscall"

	"github.com/UserExistsError/conpty"
)

type winPTY struct {
	cp     *conpty.ConPty
	cancel context.CancelFunc
	once   sync.Once
}

// close releases the pseudo-console exactly once; closing it twice crashes the process.
func (p *winPTY) close() { p.once.Do(func() { _ = p.cp.Close() }) }

func startPTY(program string, args []string, cols, rows int) (ptySession, error) {
	parts := make([]string, 0, len(args)+1)
	for _, a := range append([]string{program}, args...) {
		parts = append(parts, syscall.EscapeArg(a))
	}
	env := append(os.Environ(), "TERM=xterm-256color")
	cp, err := conpty.Start(strings.Join(parts, " "), conpty.ConPtyDimensions(cols, rows), conpty.ConPtyEnv(env))
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &winPTY{cp: cp, cancel: cancel}
	// Closing the pseudo-console when the program exits makes Read return, which ends the session.
	go func() {
		_, _ = cp.Wait(ctx)
		p.close()
	}()
	return p, nil
}

func (p *winPTY) Read(b []byte) (int, error)  { return p.cp.Read(b) }
func (p *winPTY) Write(b []byte) (int, error) { return p.cp.Write(b) }
func (p *winPTY) Resize(cols, rows int) error { return p.cp.Resize(cols, rows) }
func (p *winPTY) Kill() {
	p.cancel()
	p.close()
}
