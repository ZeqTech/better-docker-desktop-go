package main

import "testing"

func TestSplitIncompleteUTF8(t *testing.T) {
	if n := splitIncompleteUTF8([]byte("héllo")); n != 6 {
		t.Errorf("whole text = %d", n)
	}
	b := []byte("aé") // 'é' is 2 bytes
	if n := splitIncompleteUTF8(b[:2]); n != 1 {
		t.Errorf("split character = %d", n)
	}
	if n := splitIncompleteUTF8([]byte{0xff, 0x41}); n != 2 {
		t.Errorf("invalid bytes = %d", n)
	}
	emoji := []byte("a😀")
	if n := splitIncompleteUTF8(emoji[:3]); n != 1 {
		t.Errorf("4-byte split = %d", n)
	}
}
