// Keyboard shortcuts: pure key-to-action mapping (the React hook lives in useShortcuts.ts).

import type { PageId } from "./settings";

export type ShortcutAction =
  | { type: "page"; page: PageId }
  | { type: "settings" }
  | { type: "search" }
  | { type: "refresh" }
  | { type: "delete" };

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const PAGES: PageId[] = ["containers", "images", "volumes", "builds"];

/**
 * Map a key press to an action. While the user is typing in a field only Ctrl/Cmd combinations
 * apply, so `/` and Delete keep working as normal text editing keys.
 */
export function shortcutFor(e: KeyLike, typing: boolean): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey) return null;
  if (mod && !e.shiftKey) {
    if (/^[1-4]$/.test(e.key)) return { type: "page", page: PAGES[Number(e.key) - 1] };
    if (e.key === ",") return { type: "settings" };
    if (e.key.toLowerCase() === "r") return { type: "refresh" };
    if (e.key.toLowerCase() === "f") return { type: "search" };
  }
  if (e.key === "F5") return { type: "refresh" };
  if (typing || mod) return null;
  if (e.key === "/") return { type: "search" };
  if (e.key === "Delete") return { type: "delete" };
  return null;
}

export const SHORTCUT_HELP: [string, string][] = [
  ["Ctrl+1 … Ctrl+4", "Containers, Images, Volumes, Builds"],
  ["Ctrl+,", "Settings"],
  ["/  or  Ctrl+F", "Search the current list"],
  ["Ctrl+R  or  F5", "Refresh everything"],
  ["Delete", "Delete the selected containers"],
  ["Esc", "Close a dialog"],
];
