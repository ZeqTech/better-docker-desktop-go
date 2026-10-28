// Docker event stream: parsing, routing to the views that need a refresh, and crash detection.

export interface DockerEvent {
  type: "container" | "image" | "volume" | "";
  /** Action without any ": detail" suffix, e.g. "die", "health_status". */
  action: string;
  id: string;
  name: string;
  exitCode: string;
  signal: string;
  /** Text after the colon of the action, e.g. "healthy" for "health_status: healthy". */
  detail: string;
}

/** Parse one `docker events --format '{{json .}}'` line; null for anything else. */
export function parseEvent(line: string): DockerEvent | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const type = String(j.Type ?? "");
  const actor = (j.Actor ?? {}) as { ID?: string; Attributes?: Record<string, string> };
  const attrs = actor.Attributes ?? {};
  const kind = type === "container" || type === "image" || type === "volume" ? type : "";
  const id = String(actor.ID ?? j.id ?? "");
  const rawAction = String(j.Action ?? j.status ?? "");
  const colon = rawAction.indexOf(":");
  return {
    type: kind,
    action: (colon < 0 ? rawAction : rawAction.slice(0, colon)).trim(),
    detail: colon < 0 ? "" : rawAction.slice(colon + 1).trim(),
    id,
    // Images and volumes are named by their ID (a reference or volume name).
    name: attrs.name ?? (kind === "container" || kind === "" ? "" : id.replace(/^sha256:/, "").slice(0, kind === "image" && id.startsWith("sha256:") ? 12 : 64)),
    exitCode: attrs.exitCode ?? "",
    signal: attrs.signal ?? "",
  };
}

export interface Ticks {
  containers: number;
  images: number;
  volumes: number;
}

/** Which listings an event makes stale. */
export function affected(ev: DockerEvent): (keyof Ticks)[] {
  if (ev.type === "container") return ["containers"];
  if (ev.type === "image") return ["images"];
  if (ev.type === "volume") return ["volumes"];
  return [];
}

export interface CrashAlert {
  name: string;
  reason: string;
}

/**
 * Spots containers that died on their own. `docker stop` and `kill` emit a "kill" event just before
 * "die", so a die with a recent kill is a deliberate stop and stays silent.
 */
export class CrashDetector {
  private killed = new Map<string, number>();
  constructor(private windowMs = 15_000) {}

  feed(ev: DockerEvent, now = Date.now()): CrashAlert | null {
    if (ev.type !== "container") return null;
    if (ev.action === "kill") {
      this.killed.set(ev.id, now);
      return null;
    }
    if (ev.action === "oom") return { name: ev.name || ev.id.slice(0, 12), reason: "ran out of memory" };
    if (ev.action === "die") {
      const at = this.killed.get(ev.id);
      this.killed.delete(ev.id);
      if (at !== undefined && now - at <= this.windowMs) return null;
      if (ev.exitCode === "" || ev.exitCode === "0") return null;
      return { name: ev.name || ev.id.slice(0, 12), reason: `exited with code ${ev.exitCode}` };
    }
    return null;
  }
}

export interface LoggedEvent extends DockerEvent {
  time: number;
}

const VERBS: Record<string, string> = {
  create: "created", start: "started", stop: "stopped", destroy: "removed", pause: "paused", unpause: "resumed",
  rename: "renamed", restart: "restarted", pull: "pulled", delete: "deleted", tag: "tagged", untag: "untagged",
  import: "imported", load: "loaded", oom: "ran out of memory",
};

/** A short sentence for the activity log. */
export function describeEvent(ev: DockerEvent): string {
  const subject = `${ev.type ? ev.type[0].toUpperCase() + ev.type.slice(1) : "Object"} ${ev.name || ev.id.slice(0, 12)}`;
  if (ev.action === "die") return `${subject} exited${ev.exitCode ? ` with code ${ev.exitCode}` : ""}`;
  if (ev.action === "kill") return `${subject} was sent signal ${ev.signal || "?"}`;
  if (ev.action === "health_status") return `${subject} is ${ev.detail || "checking"}`;
  return `${subject} ${VERBS[ev.action] ?? ev.action}`;
}

/** Append an event to a log, keeping the newest `max` entries. */
export function appendEvent(log: LoggedEvent[], ev: DockerEvent, time: number, max = 300): LoggedEvent[] {
  const next = [...log, { ...ev, time }];
  return next.length > max ? next.slice(next.length - max) : next;
}