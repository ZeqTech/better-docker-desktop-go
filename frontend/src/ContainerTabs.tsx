import { useState } from "react";
import { looksSecret, type ContainerDetails } from "./inspect";
import { Empty } from "./ui";

function KV({ rows }: { rows: [string, string | undefined][] }) {
  return (
    <dl className="kv">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DetailsTab({ d }: { d: ContainerDetails }) {
  return (
    <div className="details">
      <section>
        <h3>Configuration</h3>
        <KV rows={[
          ["Entrypoint", d.entrypoint], ["Command", d.command], ["Working directory", d.workdir], ["User", d.user],
          ["Restart policy", d.restartPolicy], ["Restarts so far", String(d.restartCount)],
          ["Created", d.created], ["Started", d.startedAt], ["Finished", d.finishedAt],
          ["Last exit code", d.finishedAt ? String(d.exitCode) : ""], ["Out of memory", d.oomKilled ? "Yes, killed by the OOM killer" : ""],
        ]} />
      </section>
      {d.health && (
        <section>
          <h3>Health check <span className={`tag ${d.health.status === "healthy" ? "ok" : d.health.status === "unhealthy" ? "bad" : ""}`}>{d.health.status}</span></h3>
          {d.health.failingStreak > 0 && <p className="muted">{d.health.failingStreak} failing check{d.health.failingStreak === 1 ? "" : "s"} in a row.</p>}
          <ul className="health-log">
            {d.health.log.slice(-5).reverse().map((l, i) => (
              <li key={i} className={l.exitCode === 0 ? "" : "bad"}>
                <span className="mono">{l.start.replace("T", " ").slice(0, 19)}</span>
                <span>exit {l.exitCode}</span>
                <span className="mono out">{l.output || "(no output)"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Ports</h3>
        {d.ports.length === 0 ? <p className="muted">No ports exposed.</p> : (
          <table className="mini">
            <thead><tr><th>Container</th><th>Published on</th></tr></thead>
            <tbody>
              {d.ports.map((p, i) => (
                <tr key={i}><td className="mono">{p.container}</td><td className="mono">{p.hostPort ? `${p.hostIp || "*"}:${p.hostPort}` : "not published"}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h3>Networks</h3>
        {d.networks.length === 0 ? <p className="muted">Not attached to a network.</p> : (
          <table className="mini">
            <thead><tr><th>Network</th><th>IP address</th><th>Gateway</th><th>Aliases</th></tr></thead>
            <tbody>
              {d.networks.map((n) => (
                <tr key={n.name}><td>{n.name}</td><td className="mono">{n.ip || "-"}</td><td className="mono">{n.gateway || "-"}</td><td className="mono">{n.aliases.join(", ")}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {d.labels.length > 0 && (
        <section>
          <h3>Labels</h3>
          <KV rows={d.labels.map((l) => [l.key, l.value || "(empty)"])} />
        </section>
      )}
    </div>
  );
}

export function EnvTab({ d }: { d: ContainerDetails }) {
  const [reveal, setReveal] = useState(false);
  const [query, setQuery] = useState("");
  const rows = d.env.filter((e) => !query || e.key.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="details">
      <div className="toolbar">
        <input className="grow" placeholder="Filter variables" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <label className="check"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Show secret values</label>
      </div>
      {rows.length === 0 ? <Empty>No environment variables.</Empty> : (
        <table className="mini">
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.key}>
                <td className="mono">{e.key}</td>
                <td className="mono val">{looksSecret(e.key) && !reveal ? "••••••••" : e.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function MountsTab({ d }: { d: ContainerDetails }) {
  if (d.mounts.length === 0) return <Empty>This container has no mounts.</Empty>;
  return (
    <div className="details">
      <table className="mini">
        <thead><tr><th>Type</th><th>Source</th><th>Container path</th><th>Access</th></tr></thead>
        <tbody>
          {d.mounts.map((m, i) => (
            <tr key={i}>
              <td>{m.type}</td>
              <td className="mono" title={m.source}>{m.type === "volume" && m.name ? m.name : m.source}</td>
              <td className="mono">{m.destination}</td>
              <td><span className={`tag ${m.writable ? "" : "ok"}`}>{m.writable ? "read-write" : "read-only"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
