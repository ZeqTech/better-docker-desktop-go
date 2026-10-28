import { describe, expect, it } from "vitest";
import { areaPath, linePath, niceMax, parseBytes, parseStatsLine, pushSample, rates, type Sample } from "./stats";

const ESC = String.fromCharCode(27);
const json = '{"BlockIO":"1.94MB / 229kB","CPUPerc":"0.29%","Container":"ef94","ID":"ef94","MemPerc":"0.26%","MemUsage":"20.49MiB / 7.759GiB","Name":"db","NetIO":"1.17kB / 126B","PIDs":"6"}';

describe("parseBytes", () => {
  it("handles binary and decimal units", () => {
    expect(parseBytes("0B")).toBe(0);
    expect(parseBytes("126B")).toBe(126);
    expect(parseBytes("1.17kB")).toBe(1170);
    expect(parseBytes("20.49MiB")).toBe(Math.round(20.49 * 1024 ** 2));
    expect(parseBytes("7.759GiB")).toBe(Math.round(7.759 * 1024 ** 3));
    expect(parseBytes("1.94MB")).toBe(1940000);
    expect(parseBytes("--")).toBe(0);
  });
});

describe("parseStatsLine", () => {
  it("reads a clean json line", () => {
    const s = parseStatsLine(json, 1000)!;
    expect(s).toMatchObject({ t: 1000, cpu: 0.29, memPct: 0.26, pids: 6, netRx: 1170, netTx: 126 });
    expect(s.memLimit).toBe(Math.round(7.759 * 1024 ** 3));
  });
  it("ignores the screen-clearing escape codes docker interleaves", () => {
    expect(parseStatsLine(`${ESC}[H${json} ${ESC}[K`)).not.toBeNull();
    expect(parseStatsLine(`${ESC}[J${ESC}[H${json}`)?.cpu).toBe(0.29);
  });
  it("returns null for blanks and unrelated json", () => {
    expect(parseStatsLine(` ${ESC}[K`)).toBeNull();
    expect(parseStatsLine("{}")).toBeNull();
    expect(parseStatsLine("{oops")).toBeNull();
  });
});

describe("series helpers", () => {
  const sample = (t: number): Sample => ({ t, cpu: 0, memBytes: 0, memLimit: 0, memPct: 0, netRx: 0, netTx: 0, blockRead: 0, blockWrite: 0, pids: 0 });
  it("keeps only the newest samples", () => {
    let l: Sample[] = [];
    for (let i = 0; i < 10; i++) l = pushSample(l, sample(i), 4);
    expect(l.map((s) => s.t)).toEqual([6, 7, 8, 9]);
  });
  it("computes rates and never goes negative", () => {
    expect(rates([0, 1000, 3000], [0, 1000, 2000])).toEqual([1000, 2000]);
    expect(rates([5000, 100], [0, 1000])).toEqual([0]);
    expect(rates([1], [0])).toEqual([]);
  });
  it("picks nice axis maxima", () => {
    expect(niceMax(0.3, 1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(0)).toBe(1);
  });
  it("builds svg paths", () => {
    expect(linePath([0, 50, 100], 100, 40, 100)).toBe("M0.0 40.0 L50.0 20.0 L100.0 0.0");
    expect(linePath([], 100, 40, 100)).toBe("");
    expect(areaPath([0, 100], 10, 10, 100)).toBe("M0.0 10.0 L10.0 0.0 L10.0 10 L0 10 Z");
    expect(linePath([500], 100, 40, 100)).toBe("M0.0 0.0"); // clamped to the max
  });
});
