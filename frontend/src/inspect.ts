// `docker inspect <container>` parsed into the pieces the detail tabs show. Pure functions.

export interface EnvVar {
  key: string;
  value: string;
}
export interface MountInfo {
  type: string;
  source: string;
  destination: string;
  name: string;
  writable: boolean;
}
export interface PortInfo {
  container: string; // "5432/tcp"
  hostIp: string;
  hostPort: string;
}
export interface NetworkInfo {
  name: string;
  ip: string;
  gateway: string;
  mac: string;
  aliases: string[];
}
export interface HealthCheck {
  start: string;
  exitCode: number;
  output: string;
}
export interface Health {
  status: string;
  failingStreak: number;
  log: HealthCheck[];
}
export interface ContainerDetails {
  env: EnvVar[];
  mounts: MountInfo[];
  ports: PortInfo[];
  networks: NetworkInfo[];
  health: Health | null;
  command: string;
  entrypoint: string;
  workdir: string;
  user: string;
  restartPolicy: string;
  restartCount: number;
  created: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  oomKilled: boolean;
  labels: EnvVar[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

/** Docker prints "0001-01-01T00:00:00Z" for "never"; show that as empty. */
export function cleanTime(t: string): string {
  return t.startsWith("0001-01-01") ? "" : t;
}

export function parseEnv(list: unknown): EnvVar[] {
  return arr(list)
    .map(str)
    .map((e) => {
      const i = e.indexOf("=");
      return i < 0 ? { key: e, value: "" } : { key: e.slice(0, i), value: e.slice(i + 1) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Parse the JSON array `docker inspect` prints. Returns null when it is not usable. */
export function parseInspect(text: string): ContainerDetails | null {
  let top: unknown;
  try {
    top = JSON.parse(text);
  } catch {
    return null;
  }
  const c = obj(arr(top)[0] ?? top);
  if (Object.keys(c).length === 0) return null;
  const cfg = obj(c.Config);
  const state = obj(c.State);
  const host = obj(c.HostConfig);
  const net = obj(c.NetworkSettings);

  const ports: PortInfo[] = [];
  for (const [container, binds] of Object.entries(obj(net.Ports))) {
    const list = arr(binds);
    if (list.length === 0) ports.push({ container, hostIp: "", hostPort: "" });
    for (const b of list) ports.push({ container, hostIp: str(obj(b).HostIp), hostPort: str(obj(b).HostPort) });
  }

  const h = obj(state.Health);
  const health: Health | null = state.Health
    ? {
        status: str(h.Status),
        failingStreak: num(h.FailingStreak),
        log: arr(h.Log).map((l) => ({ start: str(obj(l).Start), exitCode: num(obj(l).ExitCode), output: str(obj(l).Output).trim() })),
      }
    : null;

  const policy = obj(host.RestartPolicy);
  return {
    env: parseEnv(cfg.Env),
    mounts: arr(c.Mounts).map((m) => ({
      type: str(obj(m).Type),
      source: str(obj(m).Source),
      destination: str(obj(m).Destination),
      name: str(obj(m).Name),
      writable: obj(m).RW !== false,
    })),
    ports,
    networks: Object.entries(obj(net.Networks)).map(([name, n]) => ({
      name,
      ip: str(obj(n).IPAddress),
      gateway: str(obj(n).Gateway),
      mac: str(obj(n).MacAddress),
      aliases: arr(obj(n).Aliases).map(str),
    })),
    health,
    command: arr(cfg.Cmd).map(str).join(" "),
    entrypoint: arr(cfg.Entrypoint).map(str).join(" "),
    workdir: str(cfg.WorkingDir),
    user: str(cfg.User),
    restartPolicy: str(policy.Name) ? `${str(policy.Name)}${num(policy.MaximumRetryCount) ? `:${num(policy.MaximumRetryCount)}` : ""}` : "no",
    restartCount: num(c.RestartCount),
    created: str(c.Created),
    startedAt: cleanTime(str(state.StartedAt)),
    finishedAt: cleanTime(str(state.FinishedAt)),
    exitCode: num(state.ExitCode),
    oomKilled: state.OOMKilled === true,
    labels: Object.entries(obj(cfg.Labels)).map(([key, value]) => ({ key, value: str(value) })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Looks like a secret by name, so its value is masked until the user reveals it. */
export function looksSecret(key: string): boolean {
  return /(PASS(WORD)?|SECRET|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|AUTH)/i.test(key);
}
