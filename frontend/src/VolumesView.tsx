import { useMemo, useState } from "react";
import { api } from "./api";
import { formatSize, matches, parseDiskUsage, sortRows, type Volume } from "./docker";
import type { Ticks } from "./events";
import { VolumeDetail } from "./VolumeDetail";
import { TextPrompt } from "./ImagesView";
import { Empty, SearchBox, Summary, Th, useApp, useData, useSort } from "./ui";

export function VolumesView({ refreshKey, ticks }: { refreshKey: number; ticks: Ticks }) {
  const app = useApp();
  // `system df -v` measures every volume, so it can take a few seconds on big hosts.
  const usage = useData(async () => parseDiskUsage(await api.diskUsage()), 0, ticks.volumes);
  const [query, setQuery] = useState("");
  const [hideAnon, setHideAnon] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inspect, setInspect] = useState<Volume | null>(null);
  const { sort, dir, onSort } = useSort<Volume>("name");

  const all = useMemo(
    () => usage.data?.volumes ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usage.data, refreshKey],
  );
  const shown = useMemo(
    () => sortRows(all.filter((v) => (!hideAnon || !v.anonymous) && matches(query, v.name, v.driver)), sort, dir),
    [all, query, hideAnon, sort, dir],
  );
  const unused = all.filter((v) => v.links === 0);
  const reload = () => void usage.reload();

  const remove = async (v: Volume) => {
    const ok = await app.confirm({
      title: "Delete volume?",
      body: <>Volume <b>{v.name.length > 24 ? `${v.name.slice(0, 12)}…` : v.name}</b> and all its data ({formatSize(v.size)}) will be permanently deleted.</>,
      label: "Delete",
      danger: true,
    });
    if (ok) await app.act("Delete volume", () => api.volumeRemove(v.name, false), reload);
  };

  return (
    <section className="view">
      <header className="view-head">
        <h1>Volumes</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setCreating(true)}>New volume</button>
        <button onClick={reload}>Refresh</button>
      </header>
      <Summary
        items={[
          { label: "Volumes", value: usage.loading ? "…" : String(all.length) },
          { label: "Total size", value: usage.loading ? "…" : formatSize(all.reduce((n, v) => n + v.size, 0)) },
          { label: "Unused", value: usage.loading ? "…" : String(unused.length), sub: formatSize(unused.reduce((n, v) => n + v.size, 0)) },
        ]}
      />
      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} />
        <label className="check"><input type="checkbox" checked={hideAnon} onChange={(e) => setHideAnon(e.target.checked)} /> Hide anonymous volumes</label>
        <span className="spacer" />
        <button
          className="danger"
          disabled={unused.length === 0}
          onClick={async () => {
            const ok = await app.confirm({
              title: "Clean up unused volumes?",
              body: <>Permanently deletes {unused.length} volume{unused.length === 1 ? "" : "s"} not used by any container ({formatSize(unused.reduce((n, v) => n + v.size, 0))}). This cannot be undone.</>,
              label: "Delete volumes",
              danger: true,
            });
            if (ok) await app.act("Clean up volumes", () => api.prune("volumes"), reload);
          }}
        >
          Clean up
        </button>
      </div>
      {usage.error && <div className="banner">{usage.error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <Th<Volume> label="Name" k="name" sort={sort} dir={dir} onSort={onSort} />
              <Th<Volume> label="Status" k="links" sort={sort} dir={dir} onSort={onSort} />
              <Th<Volume> label="Driver" k="driver" sort={sort} dir={dir} onSort={onSort} />
              <Th<Volume> label="Size" k="size" sort={sort} dir={dir} onSort={onSort} num />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.name}>
                <td>
                  <button className="link mono-name" onClick={() => setInspect(v)} title={v.name}>{v.anonymous ? `${v.name.slice(0, 12)}…` : v.name}</button>
                  {v.anonymous && <small>anonymous</small>}
                </td>
                <td><span className={`tag ${v.links > 0 ? "ok" : ""}`}>{v.links > 0 ? `In use (${v.links})` : "Unused"}</span></td>
                <td className="muted">{v.driver}</td>
                <td className="num">{formatSize(v.size)}</td>
                <td className="actions">
                  <button className="icon danger" title="Delete" onClick={() => void remove(v)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty>{usage.loading ? "Measuring volumes…" : all.length ? "No volumes match your filters." : "No volumes."}</Empty>}
      </div>

      {creating && (
        <TextPrompt
          title="New volume"
          label="Name"
          placeholder="e.g. app-data"
          action="Create"
          onClose={() => setCreating(false)}
          onSubmit={(name) => {
            setCreating(false);
            void app.act(`Create volume ${name}`, () => api.volumeCreate(name), reload);
          }}
        />
      )}
      {inspect && <VolumeDetail volume={inspect} onClose={() => setInspect(null)} />}
    </section>
  );
}
