import { api } from "./api";
import { looksProd, parseItems, toNamespaces, type KubePageId, type KubeStatus } from "./kube";
import { useData } from "./ui";

export const KUBE_NAV: { id: KubePageId; label: string; icon: string }[] = [
  { id: "k-map", label: "Map", icon: "✺" },
  { id: "k-nodes", label: "Nodes", icon: "⬡" },
  { id: "k-pods", label: "Pods", icon: "◎" },
  { id: "k-workloads", label: "Workloads", icon: "☰" },
  { id: "k-services", label: "Services", icon: "⇄" },
  { id: "k-events", label: "Events", icon: "⚑" },
];

/** Kubernetes block of the sidebar: just the section links. */
export function KubeNav({ status, page, onPage }: {
  status: KubeStatus | null;
  page: string;
  onPage(p: KubePageId): void;
}) {
  if (!status) return <div className="nav-note">Checking kubectl…</div>;
  if (!status.available) return <div className="nav-note">kubectl not found. Install it to see clusters.</div>;
  if (status.contexts.length === 0) return <div className="nav-note">No contexts in your kubeconfig.</div>;

  return (
    <nav>
      {KUBE_NAV.map((n) => (
        <button key={n.id} className={page === n.id ? "active" : ""} onClick={() => onPage(n.id)}>
          <span className="nav-icon" aria-hidden>{n.icon}</span>
          {n.label}
        </button>
      ))}
    </nav>
  );
}

/** Context and namespace pickers, shown at the top of the Kubernetes pages only. */
export function KubeBar({ status, context, namespace, onContext, onNamespace }: {
  status: KubeStatus;
  context: string;
  namespace: string;
  onContext(c: string): void;
  onNamespace(ns: string): void;
}) {
  const namespaces = useData(async () => toNamespaces(parseItems(await api.kubeGet(context, "namespaces", ""))), 0, context);
  const nsList = namespaces.data ?? [];
  return (
    <div className="kube-bar">
      <label>
        Context
        <select value={context} onChange={(e) => onContext(e.target.value)} className={looksProd(context) ? "prod" : ""}>
          {status.contexts.map((c) => <option key={c} value={c}>{c}{c === status.current ? " (current)" : ""}</option>)}
        </select>
      </label>
      <label>
        Namespace
        <select value={namespace} onChange={(e) => onNamespace(e.target.value)}>
          <option value="">All namespaces</option>
          {namespace && !nsList.includes(namespace) && <option value={namespace}>{namespace}</option>}
          {nsList.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}
