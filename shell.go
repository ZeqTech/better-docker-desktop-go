package main

// Interactive shells inside containers, run through a real pseudo-terminal (ConPTY on Windows)
// so prompts, colours and line editing work.

import (
	"errors"
	"io"
	"strings"
	"sync"
	"unicode/utf8"
)

// ptySession is a running program attached to a pseudo-terminal.
type ptySession interface {
	io.ReadWriter
	Resize(cols, rows int) error
	Kill()
}

type shellOut struct {
	ID   string `json:"id"`
	Data string `json:"data"`
}

type shells struct {
	mu       sync.Mutex
	sessions map[string]ptySession
	emit     emitFunc
}

func newShells(emit emitFunc) *shells {
	return &shells{sessions: map[string]ptySession{}, emit: emit}
}

// splitIncompleteUTF8 returns how many leading bytes of buf form whole characters, so a
// multi-byte character split across reads is held back for the next chunk.
func splitIncompleteUTF8(buf []byte) int {
	n := len(buf)
	// Look at the last up-to-3 bytes for the start of a sequence that is not complete yet.
	for i := 1; i <= 3 && i <= n; i++ {
		b := buf[n-i]
		if b&0xC0 == 0x80 { // continuation byte: keep looking for its lead byte
			continue
		}
		if b >= 0xC0 && !utf8.FullRune(buf[n-i:]) {
			return n - i
		}
		break
	}
	return n
}

func clampSize(v int) int {
	if v < 1 {
		return 1
	}
	return v
}

func (h *shells) start(id string, program string, args []string, cols, rows int) error {
	sess, err := startPTY(program, args, clampSize(cols), clampSize(rows))
	if err != nil {
		return err
	}
	h.mu.Lock()
	old := h.sessions[id]
	h.sessions[id] = sess
	h.mu.Unlock()
	if old != nil {
		old.Kill()
	}
	go func() {
		pending := make([]byte, 0, 8192)
		chunk := make([]byte, 4096)
		for {
			n, err := sess.Read(chunk)
			if n > 0 {
				pending = append(pending, chunk[:n]...)
				end := splitIncompleteUTF8(pending)
				if end > 0 {
					h.emit("shell-out", shellOut{ID: id, Data: strings.ToValidUTF8(string(pending[:end]), "�")})
					pending = append(pending[:0], pending[end:]...)
				}
			}
			if err != nil {
				break
			}
		}
		h.emit("shell-end", id)
		h.mu.Lock()
		if h.sessions[id] == sess {
			delete(h.sessions, id)
		}
		h.mu.Unlock()
	}()
	return nil
}

func (h *shells) get(id string) (ptySession, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.sessions[id]
	if s == nil {
		return nil, errors.New("no such shell")
	}
	return s, nil
}

func (h *shells) write(id, data string) error {
	s, err := h.get(id)
	if err != nil {
		return err
	}
	_, err = s.Write([]byte(data))
	return err
}

func (h *shells) resize(id string, cols, rows int) error {
	s, err := h.get(id)
	if err != nil {
		return err
	}
	return s.Resize(clampSize(cols), clampSize(rows))
}

func (h *shells) stop(id string) {
	h.mu.Lock()
	s := h.sessions[id]
	delete(h.sessions, id)
	h.mu.Unlock()
	if s != nil {
		s.Kill()
	}
}
