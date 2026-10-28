// Parsing for `kubectl get -o json` output. Pure functions, no Tauri.

export type KubePageId = "k-map" | "k-nodes" | "k-pods" | "k-workloads" | "k-services" | "k-events";

export const KUBE_PAGES: KubePageId[] = ["k-map", "k-nodes", "k-pods", "k-workloads", "k-services", "k-events"];

export interface KubeStatus {
  available: boolean;
  contexts: string[];
  current: string | null;
  error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

/** The `items` of a List document; empty for anything unparsable. */
export function parseItems(text: string): Obj[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v?.items) ? v.items : [];
  } catch {
    return [];
  }
}

/** "5d", "3h", "12m", "40s" since an RFC 3339 timestamp, like kubectl's AGE column. */
export function age(ts: string | undefined, now = Date.now()): string {
  const t = ts ? Date.parse(ts) : NaN;
  if (!isFinite(t)) return "-";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ---- nodes ----------------------------------------------------------------------------------

export interface KubeNode {
  name: string;
  ready: boolean;
  status: string;
  roles: string;
  version: string;
  ip: string;
  os: string;
  cpu: string;
  memory: string;
  /** Capacity and allocatable memory in bytes (0 = unknown). */
  memBytes: number;
  allocBytes: number;
  pods: string;
  age: string;
  unschedulable: boolean;
}

const UNITS: Record<string, number> = {
  "": 1, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15,
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5,
};

/** Kubernetes quantity ("16314464Ki", "512Mi", "129e6", "1500m") in base units; NaN when unparsable. */
export function parseBytes(q: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)(?:e(\d+))?(Ki|Mi|Gi|Ti|Pi|[mkKMGTP])?$/.exec(q ?? "");
  if (!m) return NaN;
  return Number(m[1]) * 10 ** Number(m[2] ?? 0) * UNITS[m[3] ?? ""];
}

/** Bytes as "15.6 GiB" / "340 MiB" / "12 KiB". */
export function formatBytes(b: number): string {
  if (!isFinite(b) || b < 0) return "-";
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(b >= 100 * 1024 ** 3 ? 0 : 1)} GiB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MiB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KiB`;
  return `${Math.round(b)} B`;
}

/** Kubernetes memory quantity as a short "15.6 GiB"; unparsable text is returned as is. */
export function memory(q: string | undefined): string {
  const b = parseBytes(q);
  return isFinite(b) ? formatBytes(b) : q || "-";
}

export function toNodes(items: Obj[], now = Date.now()): KubeNode[] {
  return items.map((n) => {
    const labels: Obj = n.metadata?.labels ?? {};
    const roles = Object.keys(labels).filter((k) => k.startsWith("node-role.kubernetes.io/")).map((k) => k.split("/")[1]);
    const readyCond = (n.status?.conditions ?? []).find((c: Obj) => c.type === "Ready");
    const ready = readyCond?.status === "True";
    const addrs: Obj[] = n.status?.addresses ?? [];
    const unschedulable = !!n.spec?.unschedulable;
    return {
      name: n.metadata?.name ?? "",
      ready,
      status: (ready ? "Ready" : "NotReady") + (unschedulable ? ",SchedulingDisabled" : ""),
      roles: roles.join(",") || "<none>",
      version: n.status?.nodeInfo?.kubeletVersion ?? "",
      ip: addrs.find((a) => a.type === "InternalIP")?.address ?? "",
      os: n.status?.nodeInfo?.osImage ?? "",
      cpu: n.status?.capacity?.cpu ?? "-",
      memory: memory(n.status?.capacity?.memory),
      memBytes: parseBytes(n.status?.capacity?.memory) || 0,
      allocBytes: parseBytes(n.status?.allocatable?.memory) || 0,
      pods: n.status?.capacity?.pods ?? "-",
      age: age(n.metadata?.creationTimestamp, now),
      unschedulable,
    };
  });
}

// ---- pods -----------------------------------------------------------------------------------

export interface KubeContainer {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
  state: string;
}

export interface KubePod {
  name: string;
  namespace: string;
  ready: string;
  status: string;
  restarts: number;
  node: string;
  ip: string;
  age: string;
  /** Summed container memory requests and limits in bytes (0 = none set). */
  memRequest: number;
  memLimit: number;
  containers: KubeContainer[];
}

/** Colour class for a pod status, matching the dots used for Docker containers. */
export function podState(status: string): "running" | "paused" | "exited" {
  if (status === "Running" || status === "Completed" || status === "Succeeded") return "running";
  if (["Pending", "ContainerCreating", "PodInitializing", "Terminating"].includes(status) || status.startsWith("Init:")) return "paused";
  return "exited";
}

export function toPods(items: Obj[], now = Date.now()): KubePod[] {
  return items.map((p) => {
    const statuses: Obj[] = p.status?.containerStatuses ?? [];
    const specs: Obj[] = p.spec?.containers ?? [];
    const containers: KubeContainer[] = specs.map((c) => {
      const st = statuses.find((s) => s.name === c.name);
      const state = st?.state ?? {};
      const label = state.running ? "running" : state.waiting ? (state.waiting.reason ?? "waiting") : state.terminated ? (state.terminated.reason ?? "terminated") : "unknown";
      return { name: c.name, image: c.image ?? "", ready: !!st?.ready, restarts: st?.restartCount ?? 0, state: label };
    });
    let status: string = p.status?.phase ?? "Unknown";
    const initWaiting = (p.status?.initContainerStatuses ?? []).find((s: Obj) => s.state?.waiting?.reason);
    if (initWaiting && !statuses.some((s) => s.state?.running)) status = `Init:${initWaiting.state.waiting.reason}`;
    const bad = statuses.find((s) => s.state?.waiting?.reason || (s.state?.terminated && s.state.terminated.reason !== "Completed"));
    if (bad && status !== "Succeeded") status = bad.state.waiting?.reason ?? bad.state.terminated.reason;
    if (p.metadata?.deletionTimestamp) status = "Terminating";
    return {
      name: p.metadata?.name ?? "",
      namespace: p.metadata?.namespace ?? "",
      ready: `${containers.filter((c) => c.ready).length}/${specs.length}`,
      status,
      restarts: containers.reduce((n, c) => n + c.restarts, 0),
      node: p.spec?.nodeName ?? "",
      ip: p.status?.podIP ?? "",
      age: age(p.metadata?.creationTimestamp, now),
      memRequest: specs.reduce((n, c) => n + (parseBytes(c.resources?.requests?.memory) || 0), 0),
      memLimit: specs.reduce((n, c) => n + (parseBytes(c.resources?.limits?.memory) || 0), 0),
      containers,
    };
  });
}

// ---- workloads and services -----------------------------------------------------------------

export interface KubeWorkload {
  kind: "deployments" | "statefulsets" | "daemonsets";
  label: string;
  name: string;
  namespace: string;
  ready: string;
  desired: number;
  age: string;
}

export function toWorkloads(kind: KubeWorkload["kind"], items: Obj[], now = Date.now()): KubeWorkload[] {
  const label = { deployments: "Deployment", statefulsets: "StatefulSet", daemonsets: "DaemonSet" }[kind];
  return items.map((w) => {
    const desired = kind === "daemonsets" ? (w.status?.desiredNumberScheduled ?? 0) : (w.spec?.replicas ?? 0);
    const ready = w.status?.[kind === "daemonsets" ? "numberReady" : "readyReplicas"] ?? 0;
    return {
      kind, label, name: w.metadata?.name ?? "", namespace: w.metadata?.namespace ?? "",
      ready: `${ready}/${desired}`, desired, age: age(w.metadata?.creationTimestamp, now),
    };
  });
}

export interface KubeService {
  name: string;
  namespace: string;
  type: string;
  clusterIp: string;
  external: string;
  ports: string;
  age: string;
}

export function toServices(items: Obj[], now = Date.now()): KubeService[] {
  return items.map((s) => {
    const ing: Obj[] = s.status?.loadBalancer?.ingress ?? [];
    const external = [...(s.spec?.externalIPs ?? []), ...ing.map((i) => i.ip ?? i.hostname)].filter(Boolean).join(",");
    const ports = ((s.spec?.ports ?? []) as Obj[]).map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol ?? "TCP"}`).join(", ");
    return {
      name: s.metadata?.name ?? "", namespace: s.metadata?.namespace ?? "", type: s.spec?.type ?? "ClusterIP",
      clusterIp: s.spec?.clusterIP ?? "", external: external || "-", ports: ports || "-", age: age(s.metadata?.creationTimestamp, now),
    };
  });
}

// ---- events ---------------------------------------------------------------------------------

export interface KubeEvent {
  type: string;
  reason: string;
  object: string;
  namespace: string;
  message: string;
  count: number;
  last: string;
  lastTs: number;
}

/** Events newest first. */
export function toEvents(items: Obj[], now = Date.now()): KubeEvent[] {
  return items
    .map((e) => {
      const ts = e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp;
      return {
        type: e.type ?? "Normal",
        reason: e.reason ?? "",
        object: e.involvedObject ? `${String(e.involvedObject.kind ?? "").toLowerCase()}/${e.involvedObject.name ?? ""}` : "",
        namespace: e.metadata?.namespace ?? "",
        message: e.message ?? "",
        count: e.count ?? 1,
        last: age(ts, now),
        lastTs: Date.parse(ts) || 0,
      };
    })
    .sort((a, b) => b.lastTs - a.lastTs);
}

/** Names of the namespaces in a `get namespaces` list. */
export function toNamespaces(items: Obj[]): string[] {
  return items.map((n) => n.metadata?.name as string).filter(Boolean).sort();
}

const PROD = /(^|[-_.:/])(prod|production|prd)([-_.:/]|$)/i;

/** Context names that look like production get an extra warning before destructive actions. */
export function looksProd(context: string): boolean {
  return PROD.test(context);
}

// ---- metrics (metrics.k8s.io) ---------------------------------------------------------------

/** Memory in use per pod, keyed "namespace/name", from `/apis/metrics.k8s.io/v1beta1/pods`. */
export function toPodMetrics(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of parseItems(text)) {
    const bytes = ((p.containers ?? []) as Obj[]).reduce((n, c) => n + (parseBytes(c.usage?.memory) || 0), 0);
    out.set(`${p.metadata?.namespace ?? ""}/${p.metadata?.name ?? ""}`, bytes);
  }
  return out;
}

/** Memory in use per node, keyed by node name. */
export function toNodeMetrics(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of parseItems(text)) out.set(n.metadata?.name ?? "", parseBytes(n.usage?.memory) || 0);
  return out;
}
