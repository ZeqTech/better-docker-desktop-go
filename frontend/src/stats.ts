// Live container stats: parsing the `docker stats` stream and shaping samples for charts. Pure functions.

import { plain } from "./logs";

export interface Sample {
  t: number; // ms since epoch
  cpu: number; // percent of one core (can exceed 100)
  memBytes: number;
  memLimit: number;
  memPct: number;
  netRx: number; // cumulative bytes
  netTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
}

/** Binary (KiB, MiB, ...) and decimal (kB, MB, ...) units as docker prints them. */
export function parseBytes(s: string | undefined): number {
  const m = /^\s*([\d.]+)\s*([a-zA-Z]*)\s*$/.exec(s ?? "");
  if (!m) return 0;
  const u = m[2].toLowerCase();
  const f: Record<string, number> = {
    "": 1, b: 1,
    kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
  };
  return Math.round(parseFloat(m[1]) * (f[u] ?? 1));
}

const pair = (s: string | undefined): [number, number] => {
  const [a, b] = (s ?? "").split("/");
  return [parseBytes(a), parseBytes(b)];
};

/**
 * One line of `docker stats --format '{{json .}}'`. The stream repeats the screen-clearing escape
 * codes the table view uses, so strip them and pull out the JSON object.
 */
export function parseStatsLine(line: string, now = Date.now()): Sample | null {
  const m = /\{.*\}/.exec(plain(line));
  if (!m) return null;
  let j: Record<string, string>;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!("CPUPerc" in j)) return null;
  const [memBytes, memLimit] = pair(j.MemUsage);
  const [netRx, netTx] = pair(j.NetIO);
  const [blockRead, blockWrite] = pair(j.BlockIO);
  return {
    t: now,
    cpu: parseFloat(j.CPUPerc) || 0,
    memBytes,
    memLimit,
    memPct: parseFloat(j.MemPerc) || 0,
    netRx, netTx, blockRead, blockWrite,
    pids: parseInt(j.PIDs, 10) || 0,
  };
}

/** Append a sample, keeping the most recent `max`. */
export function pushSample(list: Sample[], s: Sample, max = 90): Sample[] {
  const next = [...list, s];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Bytes per second between consecutive cumulative counters (never negative: counters reset on restart). */
export function rates(values: number[], times: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const dt = (times[i] - times[i - 1]) / 1000;
    out.push(dt > 0 ? Math.max(0, (values[i] - values[i - 1]) / dt) : 0);
  }
  return out;
}

/** A "nice" upper bound for a chart axis: 1, 2, 5 times a power of ten. */
export function niceMax(v: number, floor = 1): number {
  const x = Math.max(v, floor);
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (x <= m * p) return m * p;
  return 10 * p;
}

/** SVG path for a line chart; `values` are spread across the width, 0 at the bottom, `max` at the top. */
export function linePath(values: number[], w: number, h: number, max: number): string {
  if (values.length === 0) return "";
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${(h - (Math.min(v, max) / max) * h).toFixed(1)}`)
    .join(" ");
}

/** Closed version of `linePath` for the filled area under the line. */
export function areaPath(values: number[], w: number, h: number, max: number): string {
  if (values.length === 0) return "";
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return `${linePath(values, w, h, max)} L${((values.length - 1) * step).toFixed(1)} ${h} L0 ${h} Z`;
}
