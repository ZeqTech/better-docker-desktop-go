// Log line colouring: ANSI colour codes from the container plus log-level detection. Pure functions.

export type Level = "error" | "warn" | "info" | "debug" | "";

export interface Segment {
  text: string;
  /** Class names such as "a31" (red) or "ab" (bold); empty for plain text. */
  cls: string;
}

export interface ParsedLine {
  ts: string;
  level: Level;
  segments: Segment[];
}

const ESC = String.fromCharCode(27);
const CSI = new RegExp(`${ESC}\\[([0-9;?]*)([ -/]*[@-~])`, "g");
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s?(.*)$/s;

/** Remove every escape sequence (used for copying and level detection). */
export function plain(s: string): string {
  return s.replace(CSI, "");
}

/** Docker's `--timestamps` prefix, split off so it can be dimmed. */
export function splitTimestamp(line: string): { ts: string; text: string } {
  const m = TIMESTAMP.exec(line);
  return m ? { ts: m[1], text: m[2] } : { ts: "", text: line };
}

export function levelOf(text: string): Level {
  const t = plain(text);
  const key = /(?:\blevel|\bseverity|\blvl)["']?\s*[=:]\s*["']?(\w+)/i.exec(t)?.[1]?.toLowerCase();
  if (key) {
    if (/^(error|err|fatal|critical|panic|crit)$/.test(key)) return "error";
    if (/^(warn|warning)$/.test(key)) return "warn";
    if (key === "info") return "info";
    if (/^(debug|trace)$/.test(key)) return "debug";
  }
  if (/\b(ERROR|ERR|FATAL|CRITICAL|PANIC|SEVERE)\b|\b(error|fatal|panic|exception|traceback)\b/i.test(t) && !/\b(0 errors?|no errors?)\b/i.test(t)) return "error";
  if (/\b(WARN|WARNING)\b|\bwarning\b/i.test(t)) return "warn";
  if (/\bINFO\b/.test(t)) return "info";
  if (/\b(DEBUG[1-5]?|TRACE)\b/.test(t)) return "debug";
  return "";
}

/** Split text into segments with the ANSI colour / bold state that applies to each. */
export function parseAnsi(text: string): Segment[] {
  const out: Segment[] = [];
  let fg = "";
  let bold = false;
  let last = 0;
  const push = (s: string) => {
    if (!s) return;
    const cls = [fg, bold ? "ab" : ""].filter(Boolean).join(" ");
    const prev = out[out.length - 1];
    if (prev && prev.cls === cls) prev.text += s;
    else out.push({ text: s, cls });
  };
  for (const m of text.matchAll(CSI)) {
    push(text.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    if (m[2] !== "m") continue; // cursor movement etc.: drop
    const codes = m[1] === "" ? [0] : m[1].split(";").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { fg = ""; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) fg = "";
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) fg = `a${c}`;
      else if (c === 38 || c === 48) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0; // 256/true colour: skip
    }
  }
  push(text.slice(last));
  return out;
}

const WORD_CLASS: [RegExp, string][] = [
  [/^(ERROR|ERR|FATAL|PANIC|CRITICAL)/, "error"],
  [/^WARN/, "warn"],
  [/^(DEBUG|TRACE)/, "debug"],
  [/^(STATEMENT|DETAIL|HINT|CONTEXT)/, "note"],
  [/^(LOG|INFO|NOTICE)/, "info"],
];

const TOKENS = new RegExp(
  [
    String.raw`(?<time>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:\s?(?:UTC|GMT|Z|[+-]\d{2}:?\d{2}))?)`,
    String.raw`(?<pid>\[\d+\])`,
    String.raw`(?<br>\[[^\]\s]{1,40}\])`,
    String.raw`(?<lvl>\b(?:DEBUG[1-5]?|TRACE|INFO|NOTICE|LOG|WARN(?:ING)?|ERROR|ERR|FATAL|PANIC|CRITICAL|STATEMENT|DETAIL|HINT|CONTEXT)\b:?)`,
    String.raw`(?<str>"[^"\n]*"|'[^'\n]*')`,
    String.raw`(?<url>https?:\/\/[^\s"')]+)`,
    String.raw`(?<ip>\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b)`,
    String.raw`(?<key>\b[A-Za-z_][\w.-]*(?==))`,
  ].join("|"),
  "g",
);

/** Highlight timestamps, [pids], level words, quoted strings, URLs, IPs and key= in uncoloured text. */
export function tokenize(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKENS)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), cls: "" });
    const g = m.groups ?? {};
    let cls = "";
    if (g.time) cls = "tk-time";
    else if (g.pid) cls = "tk-pid";
    else if (g.br) cls = "tk-br";
    else if (g.lvl) cls = `tk-${WORD_CLASS.find(([re]) => re.test(g.lvl))?.[1] ?? "info"}`;
    else if (g.str) cls = "tk-str";
    else if (g.url) cls = "tk-url";
    else if (g.ip) cls = "tk-ip";
    else if (g.key) cls = "tk-key";
    out.push({ text: m[0], cls });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), cls: "" });
  return out;
}

/** Docker trims trailing zeros from timestamps; pad to a fixed width so columns line up. */
export function padTimestamp(ts: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(ts);
  return m ? `${m[1]}.${(m[2] ?? "").padEnd(9, "0").slice(0, 9)}${m[3]}` : ts;
}

export function parseLine(line: string): ParsedLine {
  const { ts, text } = splitTimestamp(line);
  const segments = parseAnsi(text).flatMap((s) => (s.cls === "" ? tokenize(s.text) : [s]));
  return { ts: padTimestamp(ts), level: levelOf(text), segments };
}
