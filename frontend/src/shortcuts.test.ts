import { describe, expect, it } from "vitest";
import { shortcutFor, type KeyLike } from "./shortcuts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("shortcutFor", () => {
  it("switches pages with Ctrl+1..4", () => {
    expect(shortcutFor(key("1", { ctrlKey: true }), false)).toEqual({ type: "page", page: "containers" });
    expect(shortcutFor(key("4", { metaKey: true }), true)).toEqual({ type: "page", page: "builds" });
    expect(shortcutFor(key("5", { ctrlKey: true }), false)).toBeNull();
  });
  it("opens settings, search and refresh", () => {
    expect(shortcutFor(key(",", { ctrlKey: true }), false)).toEqual({ type: "settings" });
    expect(shortcutFor(key("f", { ctrlKey: true }), true)).toEqual({ type: "search" });
    expect(shortcutFor(key("R", { ctrlKey: true }), false)).toEqual({ type: "refresh" });
    expect(shortcutFor(key("F5"), true)).toEqual({ type: "refresh" });
  });
  it("uses plain keys only when not typing", () => {
    expect(shortcutFor(key("/"), false)).toEqual({ type: "search" });
    expect(shortcutFor(key("/"), true)).toBeNull();
    expect(shortcutFor(key("Delete"), false)).toEqual({ type: "delete" });
    expect(shortcutFor(key("Delete"), true)).toBeNull();
  });
  it("ignores Alt and Shift combinations and unrelated keys", () => {
    expect(shortcutFor(key("1", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(shortcutFor(key("r", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(shortcutFor(key("a"), false)).toBeNull();
  });
});
