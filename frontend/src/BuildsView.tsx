import { useMemo, useState } from "react";
import { pickFolder } from "./platform";
import { api } from "./api";
import {
  formatDuration, formatSize, matches, parseDiskUsage, timeAgo, toBuilds,
  type BuildRecord, type CacheRecord,
} from "./docker";
import type { Ticks } from "./events";
import { StreamModal } from "./StreamPanel";
import { Empty, Modal, SearchBox, Summary, useApp, useData } from "./ui";

export function BuildsView({ refreshKey, ticks }: { refreshKey: number; ticks: Ticks }) {
  const app = useApp();
  const [tab, setTab] = useState<"history" | "cache">("history");
  const history = useData(api.buildHistory, 0, ticks.images);
  const usage = useData(async () => parseDiskUsage(await api.diskUsage()));
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [build, setBuild] = useState<{ tag: string; dir: string } | null>(null);

  const builds = useMemo(
    () => toBuilds(history.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.data, refreshKey],
  );
  const cache = usage.data?.cache ?? [];
  const reload = () => {
    void history.reload();
    void usage.reload();
  };

  const ok = builds.filter((b) => b.status === "Completed").length;
  const failed = builds.filter((b) => b.status === "Error").length;
  const cacheSize = cache.reduce((n, c) => n + c.size, 0);

  const shownBuilds = builds.filter((b) => matches(query, b.name, b.status, b.ref));
  const shownCache = cache.filter((c) => matches(query, c.description, c.id, c.type));

  return (
    <section className="view">
      <header className="view-head">
        <h1>Builds</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setCreating(true)}>New build</button>
        <button onClick={reload}>Refresh</button>
      </header>
      <Summary
        items={[
          { label: "Builds", value: String(builds.length), sub: `${ok} completed, ${failed} failed` },
          { label: "Build cache", value: usage.loading ? "…" : formatSize(cacheSize), sub: `${cache.length} records` },
          { label: "Reclaimable", value: usage.loading ? "…" : formatSize(cache.filter((c) => !c.inUse).reduce((n, c) => n + c.size, 0)) },
        ]}
      />
      <div className="tabs">
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Build history</button>
        <button className={tab === "cache" ? "active" : ""} onClick={() => setTab("cache")}>Build cache</button>
      </div>
      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} />
        <span className="spacer" />
        {tab === "cache" && (
          <button
            className="danger"
            disabled={cache.length === 0}
            onClick={async () => {
              const yes = await app.confirm({
                title: "Clear build cache?",
                body: <>Removes all unused build cache ({formatSize(cache.filter((c) => !c.inUse).reduce((n, c) => n + c.size, 0))}). The next builds will be slower.</>,
                label: "Clear cache",
                danger: true,
              });
              if (yes) await app.act("Clear build cache", () => api.prune("buildcache"), reload);
            }}
          >
            Clean up
          </button>
        )}
      </div>

      {tab === "history" ? (
        <>
          {history.error && (
            <div className="banner">
              Build history is unavailable: {history.error}
              <br />It needs Docker Buildx 0.20 or newer.
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Status</th><th className="num">Duration</th><th>Steps</th><th>Started</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {shownBuilds.map((b) => (
                  <HistoryRow
                    key={b.ref}
                    b={b}
                    onDelete={async () => {
                      const yes = await app.confirm({ title: "Delete build record?", body: <>The record for <b>{b.name}</b> is removed. Images it produced are kept.</>, label: "Delete", danger: true });
                      if (yes) await app.act("Delete build record", () => api.buildHistoryRemove(b.ref), reload);
                    }}
                  />
                ))}
              </tbody>
            </table>
            {shownBuilds.length === 0 && !history.error && <Empty>{history.loading ? "Loading…" : "No builds yet. Start one with New build."}</Empty>}
          </div>
        </>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Type</th><th>Description</th><th>Status</th><th className="num">Size</th><th>Last used</th><th className="num">Uses</th></tr>
            </thead>
            <tbody>
              {shownCache.map((c) => <CacheRow key={c.id} c={c} />)}
            </tbody>
          </table>
          {shownCache.length === 0 && <Empty>{usage.loading ? "Loading…" : "Build cache is empty."}</Empty>}
        </div>
      )}

      {creating && <NewBuildDialog onClose={() => setCreating(false)} onStart={(tag, dir) => { setCreating(false); setBuild({ tag, dir }); }} />}
      {build && (
        <StreamModal
          title={`Building ${build.tag || build.dir}`}
          kind="build"
          target={build.tag}
          context={build.dir}
          onClose={() => { setBuild(null); reload(); }}
          onEnd={reload}
        />
      )}
    </section>
  );
}

function HistoryRow({ b, onDelete }: { b: BuildRecord; onDelete(): void }) {
  const cls = b.status === "Completed" ? "ok" : b.status === "Error" ? "bad" : "";
  return (
    <tr>
      <td>{b.name}<small className="mono">{b.ref.split("/").pop()}</small></td>
      <td><span className={`tag ${cls}`}>{b.status}</span></td>
      <td className="num">{formatDuration(b.seconds)}</td>
      <td>{b.done}/{b.steps}{b.cached > 0 && <small>{b.cached} cached</small>}</td>
      <td className="muted">{timeAgo(b.created)}</td>
      <td className="actions"><button className="icon danger" title="Delete record" onClick={onDelete}>🗑</button></td>
    </tr>
  );
}

function CacheRow({ c }: { c: CacheRecord }) {
  return (
    <tr>
      <td className="mono">{c.id.slice(0, 12)}</td>
      <td className="muted">{c.type}</td>
      <td className="desc" title={c.description}>{c.description}</td>
      <td><span className={`tag ${c.inUse ? "ok" : ""}`}>{c.inUse ? "In use" : "Unused"}</span></td>
      <td className="num">{formatSize(c.size)}</td>
      <td className="muted">{c.lastUsed}</td>
      <td className="num">{c.usage}</td>
    </tr>
  );
}

function NewBuildDialog({ onClose, onStart }: { onClose(): void; onStart(tag: string, dir: string): void }) {
  const [dir, setDir] = useState("");
  const [tag, setTag] = useState("");
  return (
    <Modal title="New build" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (dir) onStart(tag.trim(), dir);
        }}
      >
        <label>
          Build context (folder containing a Dockerfile)
          <span className="row">
            <input value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
            <button
              type="button"
              onClick={async () => {
                const picked = await pickFolder();
                if (picked) setDir(picked);
              }}
            >
              Browse…
            </button>
          </span>
        </label>
        <label>Image tag (optional)<input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. myapp:latest" spellCheck={false} /></label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!dir.trim()}>Build</button>
        </div>
      </form>
    </Modal>
  );
}
