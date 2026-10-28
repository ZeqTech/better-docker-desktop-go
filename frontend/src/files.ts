// `ls -la` output from inside a container, parsed into rows, plus small path helpers. Pure functions.

export type FileKind = "dir" | "file" | "link" | "other";

export interface FileEntry {
  name: string;
  kind: FileKind;
  mode: string; // e.g. drwxr-xr-x
  owner: string;
  group: string;
  size: number;
  modified: string;
  target: string; // symlink target, else ""
}

// mode, links, owner, group, size (or "major, minor"), date (busybox/GNU "Oct 22 02:58" or ISO), name
const LINE = /^([-dlcbps])([rwxsStT-]{9})[+.@]?\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)(?:,\s*\d+)?\s+(\w{3}\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4})|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s+[+-]\d{4})?)\s+(.+)$/;

const KIND: Record<string, FileKind> = { d: "dir", "-": "file", l: "link" };

/** Parse `ls -la`; skips the "total" line and the `.` / `..` entries. Directories sort first. */
export function parseLs(text: string): FileEntry[] {
  const out: FileEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw.trimEnd());
    if (!m) continue;
    let name = m[7];
    let target = "";
    if (m[1] === "l") {
      const i = name.indexOf(" -> ");
      if (i >= 0) {
        target = name.slice(i + 4);
        name = name.slice(0, i);
      }
    }
    if (name === "." || name === "..") continue;
    out.push({ name, kind: KIND[m[1]] ?? "other", mode: m[1] + m[2], owner: m[3], group: m[4], size: Number(m[5]), modified: m[6], target });
  }
  return out.sort((a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
}

/** Join a directory and a child name using forward slashes. */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

export function parentPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

/** `/var/log` becomes [["/", "/"], ["var", "/var"], ["log", "/var/log"]]. */
export function breadcrumbs(p: string): [string, string][] {
  const parts = p.split("/").filter(Boolean);
  return [["/", "/"], ...parts.map((part, i): [string, string] => [part, "/" + parts.slice(0, i + 1).join("/")])];
}

// ---- file preview ---------------------------------------------------------------------

export const PREVIEW_LIMIT = 65536;

export interface Preview {
  binary: boolean;
  truncated: boolean;
  text: string;
}

/** Decide how to show the (at most 64 KiB) start of a file. */
export function describePreview(content: string): Preview {
  const binary = content.includes("\u0000");
  const truncated = new TextEncoder().encode(content).length >= PREVIEW_LIMIT;
  return { binary, truncated, text: binary ? "" : content };
}
