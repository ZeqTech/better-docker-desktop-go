import { useEffect, useRef } from "react";
import { shortcutFor, type ShortcutAction } from "./shortcuts";

/** True while the focus is in something the user types into. */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * Run `handler` for matching shortcuts. Return true from it to say the key was handled (the
 * browser default is then suppressed). Several components can listen at once.
 */
export function useShortcuts(handler: (a: ShortcutAction) => boolean | void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // A dialog is open: leave the keys to it.
      if (document.querySelector(".backdrop") && !(e.ctrlKey || e.metaKey)) return;
      const a = shortcutFor(e, isTyping());
      if (a && ref.current(a)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Focus the search box of the visible list. Returns whether one was found. */
export function focusSearch(): boolean {
  const input = document.querySelector<HTMLInputElement>(".search input");
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}
