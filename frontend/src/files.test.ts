import { describe, expect, it } from "vitest";
import { PREVIEW_LIMIT, breadcrumbs, describePreview, joinPath, parentPath, parseLs } from "./files";

const busybox = `total 12
drwxr-xr-x    1 root     root          4096 Oct 22 02:58 .
drwxr-xr-x    1 root     root          4096 Oct 22 02:58 ..
-rw-r--r--    1 root     root           220 Sep 17  2025 .profile
drwxrwxrwt    2 root     root          4096 Sep 17 17:32 tmp
lrwxrwxrwx    1 root     root             9 Sep 17 17:32 var-run -> /run/data
-rwxr-xr-x    1 root     root       1234567 Oct 22 02:58 file with spaces.sh
`;

const gnuIso = `total 8
drwxr-xr-x 2 root root 4096 2026-10-22 02:58:35.123456789 +0000 .
-rw-r--r-- 1 www-data www-data 12 2026-10-22 02:58 index.html
crw-rw-rw- 1 root root 1, 3 2026-10-22 02:58 null
`;

describe("parseLs", () => {
  it("parses busybox output, skipping total, . and ..", () => {
    const f = parseLs(busybox);
    expect(f.map((e) => e.name)).toEqual(["tmp", ".profile", "file with spaces.sh", "var-run"]);
    expect(f[0]).toMatchObject({ kind: "dir", mode: "drwxrwxrwt", owner: "root" });
    expect(f.find((e) => e.name === ".profile")).toMatchObject({ kind: "file", size: 220, modified: "Sep 17  2025" });
  });
  it("keeps spaces in names and splits symlink targets", () => {
    const f = parseLs(busybox);
    expect(f.find((e) => e.name === "file with spaces.sh")!.size).toBe(1234567);
    expect(f.find((e) => e.name === "var-run")).toMatchObject({ kind: "link", target: "/run/data" });
  });
  it("parses GNU ISO dates and device nodes", () => {
    const f = parseLs(gnuIso);
    expect(f.map((e) => e.name)).toEqual(["index.html", "null"]);
    expect(f[0]).toMatchObject({ owner: "www-data", size: 12, modified: "2026-10-22 02:58" });
    expect(f[1].kind).toBe("other");
  });
  it("returns nothing for errors and empty output", () => {
    expect(parseLs("")).toEqual([]);
    expect(parseLs("ls: /nope: No such file or directory")).toEqual([]);
  });
});

describe("paths", () => {
  it("joins without doubling slashes", () => {
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(joinPath("/var/", "log")).toBe("/var/log");
  });
  it("finds the parent", () => {
    expect(parentPath("/var/log")).toBe("/var");
    expect(parentPath("/var")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
  it("builds breadcrumbs", () => {
    expect(breadcrumbs("/")).toEqual([["/", "/"]]);
    expect(breadcrumbs("/var/log")).toEqual([["/", "/"], ["var", "/var"], ["log", "/var/log"]]);
  });
});

describe("describePreview", () => {
  it("shows plain text", () => {
    expect(describePreview("hello\n")).toEqual({ binary: false, truncated: false, text: "hello\n" });
  });
  it("hides binary content", () => {
    expect(describePreview("ab\u0000cd")).toMatchObject({ binary: true, text: "" });
  });
  it("flags a full-size read as truncated", () => {
    expect(describePreview("x".repeat(PREVIEW_LIMIT)).truncated).toBe(true);
    expect(describePreview("x".repeat(PREVIEW_LIMIT - 1)).truncated).toBe(false);
  });
});