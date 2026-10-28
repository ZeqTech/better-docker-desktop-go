// Parsing and formatting for `docker ... --format json` output. Pure functions, no Tauri.

export type Row = Record<string, string>;

/** JSON lines (docker ps, images, ...) or a JSON array; blank and unparsable lines are skipped. */
export function parseLines(text: string): Row[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const v = JSON.parse(t);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  const out: Row[] = [];
  for (const line of t.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Decimal sizes as printed by docker: "0B", "374MB", "1.16GB", "12.3kB". */
export function parseSize(s: string | undefined): number {
  const m = /^\s*([\d.]+)\s*([a-zA-Z]*)/.exec(s ?? "");
  if (!m) return 0;
  const unit: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
  return Math.round(parseFloat(m[1]) * (unit[m[2].toLowerCase()] ?? 1));
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1000;
    i++;
  } while (v >= 1000 && i < units.length - 1);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m < 60 ? `${m}m ${s}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Remove ANSI colour / cursor escape sequences from a log line. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function shortId(id: string): string {
  return id.replace(/^sha256:/, "").slice(0, 12);
}

// ---- containers -----------------------------------------------------------------------

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
  project: string;
  cpu: number | null;
  mem: string;
}

export function labelValue(labels: string | undefined, key: string): string {
  for (const part of (labels ?? "").split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === key) return part.slice(eq + 1);
  }
  return "";
}

export function toContainers(rows: Row[], stats: Row[] = []): Container[] {
  const byId = new Map(stats.map((s) => [s.ID ?? s.Container, s]));
  return rows.map((r) => {
    const st = byId.get((r.ID ?? "").slice(0, 12)) ?? byId.get(r.ID);
    return {
      id: r.ID ?? "",
      name: (r.Names ?? "").split(",")[0],
      image: r.Image ?? "",
      state: r.State ?? "",
      status: r.Status ?? "",
      ports: r.Ports ?? "",
      created: r.RunningFor ?? "",
      project: labelValue(r.Labels, "com.docker.compose.project"),
      cpu: st ? parseFloat(st.CPUPerc) || 0 : null,
      mem: st?.MemUsage?.split(" / ")[0] ?? "",
    };
  });
}

/** Distinct published host ports from "0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp". */
export function hostPorts(ports: string): number[] {
  const seen = new Set<number>();
  for (const m of ports.matchAll(/:(\d+)->/g)) seen.add(Number(m[1]));
  return [...seen];
}

export type ContainerAction = "start" | "stop" | "restart" | "pause" | "unpause" | "kill" | "remove";

/** Actions that make sense for a container in this state. */
export function actionsFor(state: string): ContainerAction[] {
  switch (state) {
    case "running": return ["stop", "restart", "pause", "kill", "remove"];
    case "paused": return ["unpause", "kill", "remove"];
    case "restarting": return ["stop", "kill", "remove"];
    default: return ["start", "remove"];
  }
}

// ---- images ---------------------------------------------------------------------------

export interface Image {
  id: string;
  ref: string; // repo:tag, or the short ID when untagged
  repo: string;
  tag: string;
  size: number;
  created: string;
  inUse: boolean;
}

export function toImages(rows: Row[], containers: Container[]): Image[] {
  return rows.map((r) => {
    const id = r.ID ?? "";
    const repo = r.Repository ?? "<none>";
    const tag = r.Tag ?? "<none>";
    const ref = repo === "<none>" ? shortId(id) : tag === "<none>" ? repo : `${repo}:${tag}`;
    const sid = shortId(id);
    const inUse = containers.some(
      (c) => c.image === ref || c.image === sid || c.image === repo || shortId(c.image) === sid,
    );
    return { id, ref, repo, tag, size: parseSize(r.Size), created: r.CreatedSince ?? "", inUse };
  });
}

// ---- volumes & build cache (from `system df -v`) --------------------------------------

export interface Volume {
  name: string;
  driver: string;
  size: number;
  links: number;
  mountpoint: string;
  anonymous: boolean;
}

export interface CacheRecord {
  id: string;
  type: string;
  description: string;
  inUse: boolean;
  size: number;
  lastUsed: string;
  usage: number;
}

export interface DiskUsage {
  volumes: Volume[];
  cache: CacheRecord[];
}

export function parseDiskUsage(text: string): DiskUsage {
  let j: { Volumes?: Row[]; BuildCache?: Row[] } = {};
  try {
    j = JSON.parse(text);
  } catch {
    /* empty */
  }
  return {
    volumes: (j.Volumes ?? []).map((v) => ({
      name: v.Name ?? "",
      driver: v.Driver ?? "",
      size: parseSize(v.Size),
      links: parseInt(v.Links, 10) || 0,
      mountpoint: v.Mountpoint ?? "",
      anonymous: (v.Labels ?? "").includes("com.docker.volume.anonymous"),
    })),
    cache: (j.BuildCache ?? []).map((c) => ({
      id: c.ID ?? "",
      type: c.CacheType ?? "",
      description: c.Description ?? "",
      inUse: c.InUse === "true",
      size: parseSize(c.Size),
      lastUsed: c.LastUsedSince ?? "",
      usage: parseInt(c.UsageCount, 10) || 0,
    })),
  };
}

// ---- build history --------------------------------------------------------------------

export interface BuildRecord {
  ref: string;
  name: string;
  status: string;
  created: Date;
  seconds: number;
  steps: number;
  done: number;
  cached: number;
}

export function toBuilds(rows: Row[]): BuildRecord[] {
  return (rows as unknown as Record<string, string | number>[])
    .map((r) => {
      const created = new Date(String(r.created_at ?? ""));
      const completed = r.completed_at ? new Date(String(r.completed_at)) : null;
      return {
        ref: String(r.ref ?? ""),
        name: String(r.name ?? "") || "(unnamed)",
        status: String(r.status ?? ""),
        created,
        seconds: completed ? (completed.getTime() - created.getTime()) / 1000 : NaN,
        steps: Number(r.total_steps ?? 0),
        done: Number(r.completed_steps ?? 0),
        cached: Number(r.cached_steps ?? 0),
      };
    })
    .sort((a, b) => b.created.getTime() - a.created.getTime());
}

export function timeAgo(d: Date, now = new Date()): string {
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (isNaN(s)) return "-";
  if (s < 60) return "just now";
  const units: [number, string][] = [[86400 * 30, "month"], [86400 * 7, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [n, name] of units) {
    if (s >= n) {
      const v = Math.floor(s / n);
      return `${v} ${name}${v === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

// ---- table helpers --------------------------------------------------------------------

export type Dir = "asc" | "desc";

export function sortRows<T>(rows: T[], key: keyof T, dir: Dir): T[] {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (typeof x === "number" && typeof y === "number") return (x - y) * m;
    return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }) * m;
  });
}

export function matches(query: string, ...fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f.toLowerCase().includes(q));
}

/** Group containers by compose project; standalone containers get an empty key. */
export function groupByProject(list: Container[]): [string, Container[]][] {
  const map = new Map<string, Container[]>();
  for (const c of list) map.set(c.project, [...(map.get(c.project) ?? []), c]);
  return [...map.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
}

/** Apply a saved project order; projects missing from it keep their alphabetical place after the ordered ones. Ungrouped containers stay last. */
export function orderGroups(groups: [string, Container[]][], order: string[]): [string, Container[]][] {
  const rank = (p: string) => (p === "" ? Infinity : order.includes(p) ? order.indexOf(p) : order.length);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
}

/** New saved order after moving `project` one step up or down among the shown projects. */
export function moveProject(shown: string[], order: string[], project: string, dir: -1 | 1): string[] {
  const names = shown.filter((p) => p !== "");
  const i = names.indexOf(project);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= names.length) return order;
  [names[i], names[j]] = [names[j], names[i]];
  // Keep remembered projects that are not currently shown (e.g. filtered out) after the visible ones.
  return [...names, ...order.filter((p) => !names.includes(p))];
}

// ---- image layers ---------------------------------------------------------------------

export interface Layer {
  id: string; // "" when the layer is not stored locally (<missing>)
  command: string;
  size: number;
  created: string;
}

/** Turn Dockerfile history into something readable: drop the shell wrapper, collapse whitespace. */
export function cleanLayerCommand(s: string): string {
  return s
    .replace(/^\/bin\/sh -c #\(nop\)\s*/, "")
    .replace(/^\/bin\/sh -c\s+/, "RUN ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rows of `docker history --format json`, oldest layer first (the order the image was built). */
export function toLayers(rows: Row[]): Layer[] {
  return rows
    .map((r) => ({
      id: (r.ID ?? "").startsWith("<") ? "" : shortId(r.ID ?? ""),
      command: cleanLayerCommand(r.CreatedBy ?? ""),
      size: parseSize(r.Size),
      created: r.CreatedSince ?? "",
    }))
    .reverse();
}
