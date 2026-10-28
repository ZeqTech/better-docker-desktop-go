import { useMemo, useState } from "react";
import { describeEvent, type LoggedEvent } from "./events";
import { Empty, Modal } from "./ui";

const KINDS = ["all", "container", "image", "volume"] as const;

/** What Docker has done since this window opened: container, image and volume events, newest first. */
export function ActivityDialog({ log, onClose }: { log: LoggedEvent[]; onClose(): void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return log
      .filter((e) => kind === "all" || e.type === kind)
      .map((e) => ({ e, text: describeEvent(e) }))
      .filter(({ text }) => !q || text.toLowerCase().includes(q))
      .reverse();
  }, [log, kind, query]);

  return (
    <Modal title="Activity" onClose={onClose} wide>
      <div className="toolbar">
        <div className="search">
          <span aria-hidden>⌕</span>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activity" spellCheck={false} />
        </div>
        <div className="seg" role="group" aria-label="Filter by type">
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{k === "all" ? "All" : k[0].toUpperCase() + k.slice(1) + "s"}</button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <Empty>{log.length === 0 ? "Nothing yet. Events appear here as containers, images and volumes change." : "No activity matches."}</Empty>
        ) : (
          <table>
            <tbody>
              {rows.map(({ e, text }, i) => (
                <tr key={`${e.time}-${i}`} className={e.action === "die" && e.exitCode && e.exitCode !== "0" ? "crash" : ""}>
                  <td className="muted mono nowrap">{new Date(e.time).toLocaleTimeString()}</td>
                  <td><span className={`tag ${e.type}`}>{e.type || "other"}</span></td>
                  <td>{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
