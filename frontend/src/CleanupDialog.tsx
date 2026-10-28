import { useMemo, useState } from "react";
import { api, errorText, type PruneKind } from "./api";
import { cleanupItems, reclaimable, runOrder, type CleanupKey } from "./cleanup";
import { formatSize, parseDiskUsage } from "./docker";
import { Modal, useApp, useData } from "./ui";

const PRUNE: Record<CleanupKey, PruneKind> = { containers: "containers", images: "images", volumes: "volumes", cache: "buildcache" };

export function CleanupDialog({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const app = useApp();
  const data = useData(async () => {
    const [containers, images, usage] = await Promise.all([api.containers(), api.images(), api.diskUsage()]);
    const du = parseDiskUsage(usage);
    return { containerRows: containers, imageRows: images, volumes: du.volumes, cache: du.cache };
  });
  // Volumes hold data, so they start unchecked.
  const [selected, setSelected] = useState<Set<CleanupKey>>(new Set(["containers", "images", "cache"]));
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ label: string; text: string; ok: boolean }[] | null>(null);

  const items = useMemo(() => (data.data ? cleanupItems(data.data, selected) : []), [data.data, selected]);
  const total = reclaimable(items, selected);
  const toggle = (k: CleanupKey) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(k)) n.add(k);
      return n;
    });

  const go = async () => {
    const order = runOrder(selected);
    const risky = items.some((i) => i.risky && selected.has(i.key) && i.count > 0);
    const ok = await app.confirm({
      title: "Clean up?",
      body: <>This permanently removes the selected items ({formatSize(total)} plus stopped containers).{risky && " Unused volumes and their data will be deleted for good."}</>,
      label: "Clean up",
      danger: true,
    });
    if (!ok) return;
    setRunning(true);
    const out: { label: string; text: string; ok: boolean }[] = [];
    for (const k of order) {
      const label = items.find((i) => i.key === k)?.label ?? k;
      try {
        const text = await api.prune(PRUNE[k]);
        out.push({ label, text: text.split("\n").filter(Boolean).pop() ?? "Done", ok: true });
      } catch (e) {
        out.push({ label, text: errorText(e), ok: false });
      }
    }
    setResults(out);
    setRunning(false);
    onDone();
  };

  return (
    <Modal title="Clean up" onClose={onClose}>
      {results ? (
        <>
          <ul className="cleanup-results">
            {results.map((r) => (
              <li key={r.label} className={r.ok ? "" : "bad"}><b>{r.label}</b><span>{r.text}</span></li>
            ))}
          </ul>
          <div className="form-actions"><button className="primary" onClick={onClose}>Close</button></div>
        </>
      ) : (
        <>
          {data.loading && <p className="muted">Measuring what can be reclaimed…</p>}
          {data.error && <div className="banner">{data.error}</div>}
          <ul className="cleanup-list">
            {items.map((i) => (
              <li key={i.key} className={i.count === 0 ? "none" : ""}>
                <label>
                  <input type="checkbox" checked={selected.has(i.key)} disabled={i.count === 0} onChange={() => toggle(i.key)} />
                  <span className="cleanup-text">
                    <b>{i.label}{i.risky && <span className="tag bad">data loss</span>}</b>
                    <small>{i.hint}</small>
                  </span>
                  <span className="cleanup-size">
                    {i.count === 0 ? "nothing" : `${i.count}${i.bytes === null ? "" : ` · ${formatSize(i.bytes)}`}`}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="cleanup-total">Reclaims about <b>{formatSize(total)}</b></div>
          <div className="form-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="danger-solid" disabled={running || data.loading || selected.size === 0} onClick={() => void go()}>
              {running ? "Cleaning…" : "Clean up"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
