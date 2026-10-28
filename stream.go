package main

import (
	"bufio"
	"errors"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// emitFunc sends an event to the frontend.
type emitFunc func(name string, data any)

type streamLine struct {
	ID   string `json:"id"`
	Line string `json:"line"`
}

type streamEnd struct {
	ID   string `json:"id"`
	Code *int   `json:"code"`
}

// streams tracks running long-lived commands (`logs`, `pull`, `build`, ...) by frontend-chosen id.
type streams struct {
	mu   sync.Mutex
	cmds map[string]*exec.Cmd
	emit emitFunc
}

func newStreams(emit emitFunc) *streams {
	return &streams{cmds: map[string]*exec.Cmd{}, emit: emit}
}

// start runs cmd and forwards its output as `stream-line` events and its end as `stream-end`.
// Starting a second stream under the same id replaces the first.
func (s *streams) start(id string, cmd *exec.Cmd) error {
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	errPipe, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	s.mu.Lock()
	old := s.cmds[id]
	s.cmds[id] = cmd
	s.mu.Unlock()
	if old != nil && old.Process != nil {
		_ = old.Process.Kill()
	}

	var wg sync.WaitGroup
	pump := func(r io.Reader) {
		defer wg.Done()
		br := bufio.NewReaderSize(r, 64*1024)
		for {
			line, err := br.ReadString('\n')
			if line != "" {
				s.emit("stream-line", streamLine{ID: id, Line: strings.ToValidUTF8(strings.TrimRight(line, "\r\n"), "�")})
			}
			if err != nil {
				return
			}
		}
	}
	wg.Add(2)
	go pump(out)
	go pump(errPipe)

	go func() {
		wg.Wait()
		waitErr := cmd.Wait()
		var code *int
		if cmd.ProcessState != nil {
			c := cmd.ProcessState.ExitCode()
			code = &c
		} else if waitErr != nil {
			var ee *exec.ExitError
			if errors.As(waitErr, &ee) {
				c := ee.ExitCode()
				code = &c
			}
		}
		s.mu.Lock()
		// Only announce and drop our own entry; a restart under the same id may have replaced it.
		mine := s.cmds[id] == cmd
		if mine {
			delete(s.cmds, id)
		}
		s.mu.Unlock()
		if mine {
			s.emit("stream-end", streamEnd{ID: id, Code: code})
		}
	}()
	return nil
}

func (s *streams) stop(id string) {
	s.mu.Lock()
	cmd := s.cmds[id]
	delete(s.cmds, id)
	s.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
