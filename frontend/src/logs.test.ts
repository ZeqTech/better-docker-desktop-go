import { describe, expect, it } from "vitest";
import { levelOf, padTimestamp, parseAnsi, parseLine, plain, splitTimestamp, tokenize } from "./logs";

const ESC = String.fromCharCode(27);

describe("levelOf", () => {
  it("reads level keys in common formats", () => {
    expect(levelOf('time=1 level=error msg="x"')).toBe("error");
    expect(levelOf('{"level":"warn","msg":"x"}')).toBe("warn");
    expect(levelOf("level=INFO started")).toBe("info");
    expect(levelOf('{"severity":"DEBUG"}')).toBe("debug");
  });
  it("reads bare level words", () => {
    expect(levelOf("2026 ERROR connection refused")).toBe("error");
    expect(levelOf("[WARNING] disk almost full")).toBe("warn");
    expect(levelOf("INFO: listening on 8000")).toBe("info");
    expect(levelOf("DEBUG cache hit")).toBe("debug");
    expect(levelOf("Traceback (most recent call last):")).toBe("error");
  });
  it("leaves ordinary lines alone", () => {
    expect(levelOf("GET /health 200")).toBe("");
    expect(levelOf("finished with 0 errors")).toBe("");
  });
});

describe("timestamps", () => {
  it("splits the docker prefix", () => {
    expect(splitTimestamp("2026-10-21T22:00:00.123456789Z hello")).toEqual({ ts: "2026-10-21T22:00:00.123456789Z", text: "hello" });
    expect(splitTimestamp("no timestamp")).toEqual({ ts: "", text: "no timestamp" });
  });
});

describe("parseAnsi", () => {
  it("maps colour codes to classes and resets", () => {
    const segs = parseAnsi(`plain ${ESC}[31mred${ESC}[0m after`);
    expect(segs).toEqual([
      { text: "plain ", cls: "" },
      { text: "red", cls: "a31" },
      { text: " after", cls: "" },
    ]);
  });
  it("handles bold, bright colours and combined codes", () => {
    expect(parseAnsi(`${ESC}[1;92mok${ESC}[m`)).toEqual([{ text: "ok", cls: "a92 ab" }]);
  });
  it("drops cursor codes and skips 256-colour parameters", () => {
    expect(plain(`a${ESC}[2Kb${ESC}[38;5;200mc`)).toBe("abc");
    expect(parseAnsi(`${ESC}[38;5;200mhi`)).toEqual([{ text: "hi", cls: "" }]);
  });
  it("returns plain text as one segment", () => {
    expect(parseAnsi("just text")).toEqual([{ text: "just text", cls: "" }]);
    expect(parseAnsi("")).toEqual([]);
  });
});

describe("tokenize", () => {
  it("highlights a postgres line", () => {
    const segs = tokenize('2026-10-22 02:58:35.191 UTC [28] LOG:  listening on IPv4 address "0.0.0.0", port 5432');
    const by = (cls: string) => segs.filter((s) => s.cls === cls).map((s) => s.text);
    expect(by("tk-time")).toEqual(["2026-10-22 02:58:35.191 UTC"]);
    expect(by("tk-pid")).toEqual(["[28]"]);
    expect(by("tk-info")).toEqual(["LOG:"]);
    expect(by("tk-str")).toEqual(['"0.0.0.0"']);
    expect(segs.map((s) => s.text).join("")).toBe('2026-10-22 02:58:35.191 UTC [28] LOG:  listening on IPv4 address "0.0.0.0", port 5432');
  });
  it("classifies level words", () => {
    expect(tokenize("ERROR: boom")[0].cls).toBe("tk-error");
    expect(tokenize("WARNING: slow")[0].cls).toBe("tk-warn");
    expect(tokenize("DETAIL: more")[0].cls).toBe("tk-note");
    expect(tokenize("DEBUG2 x")[0].cls).toBe("tk-debug");
  });
  it("finds urls, ips and keys", () => {
    const cls = (s: string) => tokenize(s).map((x) => x.cls);
    expect(cls("see https://a.dev/x ok")).toContain("tk-url");
    expect(cls("from 10.0.0.5:8080")).toContain("tk-ip");
    expect(cls("user=alice")).toContain("tk-key");
  });
  it("returns one plain segment when nothing matches", () => {
    expect(tokenize("nothing special here")).toEqual([{ text: "nothing special here", cls: "" }]);
  });
});

describe("padTimestamp", () => {
  it("pads fractions to nine digits", () => {
    expect(padTimestamp("2026-10-22T02:58:35.19129Z")).toBe("2026-10-22T02:58:35.191290000Z");
    expect(padTimestamp("2026-10-22T02:58:35Z")).toBe("2026-10-22T02:58:35.000000000Z");
    expect(padTimestamp("")).toBe("");
  });
});

describe("parseLine", () => {
  it("combines timestamp, level and segments", () => {
    const p = parseLine(`2026-10-21T22:00:00Z ${ESC}[33mWARN${ESC}[0m slow query`);
    expect(p.ts).toBe("2026-10-21T22:00:00.000000000Z");
    expect(p.level).toBe("warn");
    expect(p.segments.map((s) => s.text).join("")).toBe("WARN slow query");
  });
});
