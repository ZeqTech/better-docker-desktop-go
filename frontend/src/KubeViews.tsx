import { useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import {
  looksProd, parseItems, podState, toEvents, toNodes, toPods, toServices, toWorkloads,
  type KubeNode, type KubePod, type KubeWorkload,
} from "./kube";
import { matches } from "./docker";
import { StreamPanel } from "./StreamPanel";
import { TerminalTab } from "./TerminalTab";
import { Empty, SearchBox, StatusDot, Summary, useApp, useData } from "./ui";
import { useSettings } from "./SettingsContext";
import { pollMs } from "./settings";

export interface KubeSel {
  context: string;
  /** Empty = all namespaces. */
  namespace: string;
}

function useKubeList<T>(kube: KubeSel, kind: string, parse: (items: ReturnType<typeof parseItems>) => T[]) {
  const { settings } = useSettings();
  const list = useData(async () => parse(parseItems(await api.kubeGet(kube.context, kind, kube.namespace))), pollMs(settings, 2));
  return list;
}

/** Confirm a change, naming the cluster; clusters that look like production get a louder warning. */
async function confirmChange(app: ReturnType<typeof useApp>, kube: KubeSel, title: string, body: ReactNode, label: string) {
  const prod = looksProd(kube.context);
  return app.confirm({
    title: prod ? `${title} (PRODUCTION)` : title,
    body: <>{body} Cluster: <b>{kube.context}</b>.{prod && <> This looks like a production cluster.</>}</>,
    label,
    danger: true,
  });
}

function ViewHead({ title, kube, reload }: { title: string; kube: KubeSel; reload(): void }) {
  return (
    <header className="view-head">
      <h1>{title}</h1>
      <span className={`tag ${looksProd(kube.context) ? "bad" : ""}`}>{kube.context}</span>
      <small className="muted">{kube.namespace || "all namespaces"}</small>
      <span className="spacer" />
      <button onClick={reload}>Refresh</button>
    </header>
  );
}

// ---- nodes ----------------------------------------------------------------------------------

export function NodesView({ kube }: { kube: KubeSel }) {
  const list = useKubeList(kube, "nodes", (i) => toNodes(i));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<KubeNode | null>(null);
  const nodes = list.data ?? [];
  const shown = nodes.filter((n) => matches(query, n.name, n.roles, n.ip, n.version));
  if (open) return <NodeDetail kube={kube} node={nodes.find((n) => n.name === open.name) ?? open} onBack={() => setOpen(null)} onChanged={() => void list.reload()} />;
  return (
    <section className="view">
      <ViewHead title="Nodes" kube={kube} reload={() => void list.reload()} />
      <Summary items={[
        { label: "Nodes", value: String(nodes.length), sub: `${nodes.filter((n) => n.ready).length} ready` },
        { label: "Control plane", value: String(nodes.filter((n) => n.roles.includes("control-plane") || n.roles.includes("master")).length) },
        { label: "Cordoned", value: String(nodes.filter((n) => n.unschedulable).length) },
      ]} />
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} /></div>
      {list.error && <div className="banner">{list.error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Roles</th><th>Version</th><th>Internal IP</th><th className="num">CPU</th><th className="num">Memory</th><th className="num">Pods</th><th>Age</th></tr></thead>
          <tbody>
            {shown.map((n) => (
              <tr key={n.name}>
                <td><div className="namecell"><StatusDot state={n.ready ? "running" : "exited"} /><button className="link" onClick={() => setOpen(n)}>{n.name}</button></div></td>
                <td>{n.status}</td><td>{n.roles}</td><td>{n.version}</td><td className="mono">{n.ip}</td>
                <td className="num">{n.cpu}</td><td className="num">{n.memory}</td><td className="num">{n.pods}</td><td className="muted">{n.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty>{list.loading ? "Loading…" : "No nodes."}</Empty>}
      </div>
    </section>
  );
}

function NodeDetail({ kube, node, onBack, onChanged }: { kube: KubeSel; node: KubeNode; onBack(): void; onChanged(): void }) {
  const app = useApp();
  const [tab, setTab] = useState<"pods" | "describe" | "yaml">("pods");
  const all = useData(async () => toPods(parseItems(await api.kubeGet(kube.context, "pods", ""))));
  const pods = (all.data ?? []).filter((p) => p.node === node.name);
  const toggle = async () => {
    const action = node.unschedulable ? "uncordon" : "cordon";
    if (action === "cordon" && !(await confirmChange(app, kube, `Cordon ${node.name}?`, <>New pods will not be scheduled on it.</>, "Cordon"))) return;
    await app.act(`${action} ${node.name}`, () => api.kubeAct(kube.context, action, "nodes", node.name, ""), onChanged);
  };
  return (
    <section className="view">
      <header className="view-head">
        <button onClick={onBack}>← Nodes</button>
        <StatusDot state={node.ready ? "running" : "exited"} />
        <h1>{node.name}</h1>
        <span className="spacer" />
        <button onClick={() => void toggle()}>{node.unschedulable ? "Uncordon" : "Cordon"}</button>
      </header>
      <div className="meta">
        <span>Status <b>{node.status}</b></span><span>Roles <b>{node.roles}</b></span><span>Version <b>{node.version}</b></span>
        <span>IP <b>{node.ip}</b></span><span>OS <b>{node.os}</b></span><span>CPU <b>{node.cpu}</b></span><span>Memory <b>{node.memory}</b></span>
      </div>
      <Tabs tabs={[["pods", `Pods (${pods.length})`], ["describe", "Describe"], ["yaml", "YAML"]]} tab={tab} onTab={(t) => setTab(t as typeof tab)} />
      <div className="tab-body">
        {tab === "pods" && (all.error ? <Empty>{all.error}</Empty> : <PodTable pods={pods} showNamespace onOpen={() => {}} loading={all.loading} />)}
        {tab === "describe" && <TextPanel load={() => api.kubeShow(kube.context, "describe", "nodes", node.name, "")} />}
        {tab === "yaml" && <TextPanel load={() => api.kubeShow(kube.context, "yaml", "nodes", node.name, "")} />}
      </div>
    </section>
  );
}

// ---- pods -----------------------------------------------------------------------------------

function PodTable({ pods, showNamespace, onOpen, loading }: { pods: KubePod[]; showNamespace: boolean; onOpen(p: KubePod): void; loading: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Name</th>{showNamespace && <th>Namespace</th>}<th>Ready</th><th>Status</th><th className="num">Restarts</th><th>Node</th><th>IP</th><th>Age</th></tr></thead>
        <tbody>
          {pods.map((p) => (
            <tr key={`${p.namespace}/${p.name}`}>
              <td><div className="namecell"><StatusDot state={podState(p.status)} /><button className="link" onClick={() => onOpen(p)}>{p.name}</button></div></td>
              {showNamespace && <td>{p.namespace}</td>}
              <td>{p.ready}</td><td>{p.status}</td><td className="num">{p.restarts}</td><td>{p.node}</td><td className="mono">{p.ip}</td><td className="muted">{p.age}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pods.length === 0 && <Empty>{loading ? "Loading…" : "No pods."}</Empty>}
    </div>
  );
}

export interface OpenPod {
  ns: string;
  name: string;
  tab: PodTab;
  /** Where "back" returns to; the Pods list when empty. */
  from?: "map";
}

export function PodsView({ kube, initial, onBackToMap }: { kube: KubeSel; initial?: OpenPod | null; onBackToMap?(): void }) {
  const list = useKubeList(kube, "pods", (i) => toPods(i));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<OpenPod | null>(initial ?? null);
  const pods = list.data ?? [];
  const shown = useMemo(() => pods.filter((p) => matches(query, p.name, p.namespace, p.status, p.node)), [pods, query]);
  const current = open && pods.find((p) => p.name === open.name && p.namespace === open.ns);
  if (open && current) {
    const toMap = open.from === "map" && onBackToMap;
    return <PodDetail kube={kube} pod={current} back={toMap ? "Map" : "Pods"} initialTab={open.tab} onBack={() => (toMap ? onBackToMap() : setOpen(null))} onChanged={() => void list.reload()} />;
  }
  const bad = pods.filter((p) => podState(p.status) === "exited").length;
  return (
    <section className="view">
      <ViewHead title="Pods" kube={kube} reload={() => void list.reload()} />
      <Summary items={[
        { label: "Pods", value: String(pods.length), sub: `${pods.filter((p) => p.status === "Running").length} running` },
        { label: "Unhealthy", value: String(bad) },
        { label: "Restarts", value: String(pods.reduce((n, p) => n + p.restarts, 0)) },
      ]} />
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} /></div>
      {list.error && <div className="banner">{list.error}</div>}
      <PodTable pods={shown} showNamespace={!kube.namespace} onOpen={(p) => setOpen({ ns: p.namespace, name: p.name, tab: "logs" })} loading={list.loading} />
    </section>
  );
}

function PodDetail({ kube, pod, back, initialTab, onBack, onChanged }: { kube: KubeSel; pod: KubePod; back: string; initialTab?: PodTab; onBack(): void; onChanged(): void }) {
  return (
    <section className="view">
      <header className="view-head">
        <button onClick={onBack}>← {back}</button>
        <StatusDot state={podState(pod.status)} />
        <h1>{pod.name}</h1>
        <small className="muted">{pod.namespace}</small>
      </header>
      <div className="meta">
        <span>Status <b>{pod.status}</b></span><span>Ready <b>{pod.ready}</b></span><span>Restarts <b>{pod.restarts}</b></span>
        <span>Node <b>{pod.node || "-"}</b></span><span>IP <b>{pod.ip || "-"}</b></span>
      </div>
      <PodTabs kube={kube} pod={pod} initialTab={initialTab} onChanged={onChanged} onRemoved={onBack} />
    </section>
  );
}

export type PodTab = "overview" | "logs" | "shell" | "containers" | "events" | "describe" | "yaml";

/**
 * Everything you can do with one pod: actions, then tabs for logs, shell, containers, events,
 * describe and YAML. With `overview` it gets a first tab holding that content (the map's panel).
 */
export function PodTabs({ kube, pod, overview, initialTab, onOpenFull, onChanged, onRemoved }: {
  kube: KubeSel;
  pod: KubePod;
  overview?: ReactNode;
  initialTab?: PodTab;
  /** Shows an "Open full screen" button that receives the current tab. */
  onOpenFull?(tab: PodTab): void;
  onChanged(): void;
  onRemoved(): void;
}) {
  const app = useApp();
  const [tab, setTab] = useState<PodTab>(initialTab ?? (overview ? "overview" : "logs"));
  const [shellOpened, setShellOpened] = useState(initialTab === "shell");
  const [container, setContainer] = useState(pod.containers[0]?.name ?? "");
  const running = pod.status === "Running";
  const kc = `kubectl --context ${kube.context} -n ${pod.namespace}`;
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text);
    app.notify(`Copied ${what}`);
  };
  const remove = async () => {
    if (!(await confirmChange(app, kube, `Delete pod ${pod.name}?`, <>Pod <b>{pod.namespace}/{pod.name}</b> is deleted; its controller may recreate it.</>, "Delete"))) return;
    if (await app.act(`Delete ${pod.name}`, () => api.kubeAct(kube.context, "delete", "pods", pod.name, pod.namespace), onChanged)) onRemoved();
  };
  const picker = pod.containers.length > 1 && (
    <div className="toolbar">
      <label className="check">Container{" "}
        <select value={container} onChange={(e) => setContainer(e.target.value)}>
          {pod.containers.map((c) => <option key={c.name}>{c.name}</option>)}
        </select>
      </label>
    </div>
  );
  const tabs: [string, string][] = [
    ...(overview ? [["overview", "Overview"] as [string, string]] : []),
    ["logs", "Logs"], ["shell", "Shell"], ["containers", "Containers"], ["events", "Events"], ["describe", "Describe"], ["yaml", "YAML"],
  ];
  return (
    <>
      <div className="toolbar pod-actions">
        <details className="menu">
          <summary>Copy</summary>
          <div className="menu-pop" onClick={(e) => e.currentTarget.parentElement?.removeAttribute("open")}>
            <button onClick={() => copy(pod.name, "pod name")}>Pod name</button>
            <button onClick={() => copy(`${kc} logs -f ${pod.name}${container ? ` -c ${container}` : ""}`, "logs command")}>kubectl logs command</button>
            <button onClick={() => copy(`${kc} exec -it ${pod.name}${container ? ` -c ${container}` : ""} -- sh`, "exec command")}>kubectl exec command</button>
            <button onClick={() => copy(`${kc} describe pod ${pod.name}`, "describe command")}>kubectl describe command</button>
          </div>
        </details>
        {onOpenFull && <button onClick={() => onOpenFull(tab)} title="Open this pod on the Pods page, full width">Open full screen ↗</button>}
        <span className="spacer" />
        <button className="icon danger" onClick={() => void remove()} title="Delete pod" aria-label="Delete pod">🗑</button>
      </div>
      <Tabs tabs={tabs} tab={tab} onTab={(t) => { setTab(t as PodTab); if (t === "shell") setShellOpened(true); }} />
      <div className="tab-body">
        {tab === "overview" && overview}
        {tab === "logs" && (<>{picker}{container && <StreamPanel key={container} kind="kubelogs" target={`${pod.namespace}/${pod.name}/${container}`} context={kube.context} />}</>)}
        {shellOpened && running && container && (
          <div className="term-wrap" style={{ display: tab === "shell" ? "flex" : "none" }}>
            {tab === "shell" && picker}
            <TerminalTab key={container} container={container} kube={{ context: kube.context, namespace: pod.namespace, pod: pod.name }} />
          </div>
        )}
        {tab === "shell" && !running && <Empty>The pod must be Running to open a shell.</Empty>}
        {tab === "containers" && (
          <div className="details">
            <table className="mini">
              <thead><tr><th>Name</th><th>Image</th><th>State</th><th>Ready</th><th className="num">Restarts</th></tr></thead>
              <tbody>
                {pod.containers.map((c) => (
                  <tr key={c.name}><td>{c.name}</td><td className="mono">{c.image}</td><td>{c.state}</td><td>{c.ready ? "yes" : "no"}</td><td className="num">{c.restarts}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "events" && <PodEvents kube={kube} pod={pod} />}
        {tab === "describe" && <TextPanel load={() => api.kubeShow(kube.context, "describe", "pods", pod.name, pod.namespace)} />}
        {tab === "yaml" && <TextPanel load={() => api.kubeShow(kube.context, "yaml", "pods", pod.name, pod.namespace)} />}
      </div>
    </>
  );
}

/** Events of the pod's namespace, narrowed to this pod. Shows why it restarts or will not start. */
function PodEvents({ kube, pod }: { kube: KubeSel; pod: KubePod }) {
  const data = useData(async () => toEvents(parseItems(await api.kubeGet(kube.context, "events", pod.namespace))).filter((e) => e.object === `pod/${pod.name}`));
  if (data.error) return <Empty>{data.error}</Empty>;
  if (!data.data) return <Empty>Loading…</Empty>;
  if (data.data.length === 0) return <Empty>No events for this pod (Kubernetes keeps them for about an hour).</Empty>;
  return (
    <div className="details">
      <table className="mini">
        <thead><tr><th>Last seen</th><th>Type</th><th>Reason</th><th>Message</th><th className="num">Count</th></tr></thead>
        <tbody>
          {data.data.map((e, i) => (
            <tr key={i}><td className="muted">{e.last}</td><td><span className={`tag ${e.type === "Warning" ? "bad" : ""}`}>{e.type}</span></td><td>{e.reason}</td><td>{e.message}</td><td className="num">{e.count}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- workloads, services, events ------------------------------------------------------------

export function WorkloadsView({ kube }: { kube: KubeSel }) {
  const app = useApp();
  const { settings } = useSettings();
  const list = useData(async () => {
    const kinds = ["deployments", "statefulsets", "daemonsets"] as const;
    const parts = await Promise.all(kinds.map(async (k) => toWorkloads(k, parseItems(await api.kubeGet(kube.context, k, kube.namespace)))));
    return parts.flat();
  }, pollMs(settings, 2));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<KubeWorkload | null>(null);
  const shown = (list.data ?? []).filter((w) => matches(query, w.name, w.namespace, w.label));
  const act = async (w: KubeWorkload, action: "restart" | "delete" | string) => {
    const verb = action === "restart" ? "Restart" : action === "delete" ? "Delete" : "Scale";
    if (!(await confirmChange(app, kube, `${verb} ${w.name}?`, <>{w.label} <b>{w.namespace}/{w.name}</b>.</>, verb))) return;
    await app.act(`${verb} ${w.name}`, () => api.kubeAct(kube.context, action, w.kind, w.name, w.namespace), () => void list.reload());
  };
  if (open) {
    return (
      <ResourceDetail
        kube={kube} kind={open.kind} name={open.name} namespace={open.namespace} title={open.name} back="Workloads" onBack={() => setOpen(null)}
        actions={
          <>
            <button onClick={() => void act(open, "restart")}>Restart</button>
            {open.kind !== "daemonsets" && (
              <button onClick={() => { const n = window.prompt(`Scale ${open.name} to how many replicas?`, String(open.desired)); if (n !== null && /^\d+$/.test(n)) void act(open, `scale=${n}`); }}>Scale…</button>
            )}
          </>
        }
      />
    );
  }
  return (
    <section className="view">
      <ViewHead title="Workloads" kube={kube} reload={() => void list.reload()} />
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} /></div>
      {list.error && <div className="banner">{list.error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Kind</th>{!kube.namespace && <th>Namespace</th>}<th>Ready</th><th>Age</th><th>Actions</th></tr></thead>
          <tbody>
            {shown.map((w) => {
              const [r, d] = w.ready.split("/");
              return (
                <tr key={`${w.kind}/${w.namespace}/${w.name}`}>
                  <td><div className="namecell"><StatusDot state={r === d ? "running" : "paused"} /><button className="link" onClick={() => setOpen(w)}>{w.name}</button></div></td>
                  <td>{w.label}</td>{!kube.namespace && <td>{w.namespace}</td>}<td>{w.ready}</td><td className="muted">{w.age}</td>
                  <td className="actions"><button className="icon" title="Rollout restart" onClick={() => void act(w, "restart")}>↻</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <Empty>{list.loading ? "Loading…" : "No workloads."}</Empty>}
      </div>
    </section>
  );
}

export function ServicesView({ kube }: { kube: KubeSel }) {
  const list = useKubeList(kube, "services", (i) => toServices(i));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ name: string; namespace: string } | null>(null);
  const shown = (list.data ?? []).filter((s) => matches(query, s.name, s.namespace, s.type, s.clusterIp));
  if (open) return <ResourceDetail kube={kube} kind="services" name={open.name} namespace={open.namespace} title={open.name} back="Services" onBack={() => setOpen(null)} />;
  return (
    <section className="view">
      <ViewHead title="Services" kube={kube} reload={() => void list.reload()} />
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} /></div>
      {list.error && <div className="banner">{list.error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th>{!kube.namespace && <th>Namespace</th>}<th>Type</th><th>Cluster IP</th><th>External</th><th>Ports</th><th>Age</th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={`${s.namespace}/${s.name}`}>
                <td><button className="link" onClick={() => setOpen({ name: s.name, namespace: s.namespace })}>{s.name}</button></td>
                {!kube.namespace && <td>{s.namespace}</td>}
                <td>{s.type}</td><td className="mono">{s.clusterIp}</td><td className="mono">{s.external}</td><td className="mono">{s.ports}</td><td className="muted">{s.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty>{list.loading ? "Loading…" : "No services."}</Empty>}
      </div>
    </section>
  );
}

export function EventsView({ kube }: { kube: KubeSel }) {
  const list = useKubeList(kube, "events", (i) => toEvents(i));
  const [query, setQuery] = useState("");
  const [warnings, setWarnings] = useState(false);
  const shown = (list.data ?? []).filter((e) => (!warnings || e.type === "Warning") && matches(query, e.reason, e.object, e.message, e.namespace)).slice(0, 500);
  return (
    <section className="view">
      <ViewHead title="Events" kube={kube} reload={() => void list.reload()} />
      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} />
        <label className="check"><input type="checkbox" checked={warnings} onChange={(e) => setWarnings(e.target.checked)} /> Warnings only</label>
      </div>
      {list.error && <div className="banner">{list.error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Last seen</th><th>Type</th><th>Reason</th><th>Object</th>{!kube.namespace && <th>Namespace</th>}<th>Message</th><th className="num">Count</th></tr></thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={i}>
                <td className="muted">{e.last}</td><td><span className={`tag ${e.type === "Warning" ? "bad" : ""}`}>{e.type}</span></td>
                <td>{e.reason}</td><td className="mono">{e.object}</td>{!kube.namespace && <td>{e.namespace}</td>}<td>{e.message}</td><td className="num">{e.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty>{list.loading ? "Loading…" : "No events."}</Empty>}
      </div>
    </section>
  );
}

// ---- shared ---------------------------------------------------------------------------------

function Tabs({ tabs, tab, onTab }: { tabs: [string, string][]; tab: string; onTab(t: string): void }) {
  return (
    <div className="tabs">
      {tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => onTab(id)}>{label}</button>)}
    </div>
  );
}

/** Output of a one-shot kubectl call (describe / yaml) in a scrollable monospace box. */
export function TextPanel({ load }: { load(): Promise<string> }) {
  const data = useData(load);
  if (data.error) return <Empty>{data.error}</Empty>;
  if (data.data === null) return <Empty>Loading…</Empty>;
  return (
    <div className="stream">
      <div className="toolbar">
        <span className="spacer" />
        <button onClick={() => navigator.clipboard?.writeText(data.data ?? "")}>Copy</button>
        <button onClick={() => void data.reload()}>Reload</button>
      </div>
      <pre className="logbox logview wrap">{data.data}</pre>
    </div>
  );
}

function ResourceDetail({ kube, kind, name, namespace, title, back, onBack, actions }: {
  kube: KubeSel; kind: string; name: string; namespace: string; title: string; back: string; onBack(): void; actions?: ReactNode;
}) {
  const [tab, setTab] = useState<"describe" | "yaml">("describe");
  return (
    <section className="view">
      <header className="view-head">
        <button onClick={onBack}>← {back}</button>
        <h1>{title}</h1>
        <small className="muted">{namespace}</small>
        <span className="spacer" />
        {actions}
      </header>
      <Tabs tabs={[["describe", "Describe"], ["yaml", "YAML"]]} tab={tab} onTab={(t) => setTab(t as typeof tab)} />
      <div className="tab-body">
        <TextPanel key={tab} load={() => api.kubeShow(kube.context, tab, kind, name, namespace)} />
      </div>
    </section>
  );
}
