import { useMemo, useState } from "react";
import { pickFile, pickSavePath } from "./platform";
import { api } from "./api";
import { formatSize, matches, sortRows, toContainers, toImages, type Image } from "./docker";
import { ImageDetail } from "./ImageDetail";
import { useSettings } from "./SettingsContext";
import { pollMs } from "./settings";
import type { Ticks } from "./events";
import { RunDialog } from "./RunDialog";
import { StreamModal } from "./StreamPanel";
import { Empty, Modal, SearchBox, Summary, Th, useApp, useData, useSort } from "./ui";

export function ImagesView({ refreshKey, ticks }: { refreshKey: number; ticks: Ticks }) {
  const app = useApp();
  const images = useData(api.images, 0, ticks.images);
  const { settings } = useSettings();
  const containers = useData(api.containers, pollMs(settings, 2), ticks.containers);
  const [query, setQuery] = useState("");
  const [onlyUnused, setOnlyUnused] = useState(false);
  const [pull, setPull] = useState<string | null>(null);
  const [asking, setAsking] = useState<"pull" | null>(null);
  const [runImage, setRunImage] = useState<Image | null>(null);
  const [tagImage, setTagImage] = useState<Image | null>(null);
  const [inspect, setInspect] = useState<Image | null>(null);
  const [job, setJob] = useState<{ title: string; kind: "save" | "load"; target: string; context: string } | null>(null);
  const { sort, dir, onSort } = useSort<Image>("ref");

  const all = useMemo(
    () => toImages(images.data ?? [], toContainers(containers.data ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images.data, containers.data, refreshKey],
  );
  const shown = useMemo(
    () => sortRows(all.filter((i) => (!onlyUnused || !i.inUse) && matches(query, i.ref, i.id)), sort, dir),
    [all, query, onlyUnused, sort, dir],
  );
  const total = all.reduce((n, i) => n + i.size, 0);
  const unused = all.filter((i) => !i.inUse);
  const reload = () => {
    void images.reload();
    void containers.reload();
  };

  const exportImage = async (i: Image) => {
    const file = await pickSavePath({ defaultPath: `${i.ref.replace(/[:/]/g, "_")}.tar`, filters: [{ name: "Image archive", extensions: ["tar"] }] });
    if (file) setJob({ title: `Exporting ${i.ref}`, kind: "save", target: i.ref, context: file });
  };

  const importImage = async () => {
    const file = await pickFile({ filters: [{ name: "Image archive", extensions: ["tar", "gz", "tgz"] }] });
    if (file) setJob({ title: "Importing image", kind: "load", target: "", context: file });
  };

  const remove = async (i: Image) => {
    const ok = await app.confirm({
      title: "Delete image?",
      body: <>Image <b>{i.ref}</b> will be removed.{i.inUse && " It is used by a container, so Docker will refuse unless that container is deleted first."}</>,
      label: "Delete",
      danger: true,
    });
    if (ok) await app.act(`Delete ${i.ref}`, () => api.imageRemove(i.id, false), reload);
  };

  return (
    <section className="view">
      <header className="view-head">
        <h1>Images</h1>
        <span className="spacer" />
        <button onClick={() => setAsking("pull")}>Pull image</button>
        <button onClick={() => void importImage()}>Import…</button>
        <button onClick={reload}>Refresh</button>
      </header>
      <Summary
        items={[
          { label: "Local images", value: String(all.length), sub: `${formatSize(total)} total` },
          { label: "In use", value: String(all.length - unused.length) },
          { label: "Unused", value: String(unused.length), sub: formatSize(unused.reduce((n, i) => n + i.size, 0)) },
        ]}
      />
      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} />
        <label className="check"><input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} /> Unused only</label>
        <span className="spacer" />
        <button
          className="danger"
          disabled={unused.length === 0}
          onClick={async () => {
            const ok = await app.confirm({
              title: "Clean up unused images?",
              body: <>Removes every image not used by a container ({unused.length}, about {formatSize(unused.reduce((n, i) => n + i.size, 0))}).</>,
              label: "Clean up",
              danger: true,
            });
            if (ok) await app.act("Clean up images", () => api.prune("images"), reload);
          }}
        >
          Clean up
        </button>
      </div>
      {images.error && <div className="banner">{images.error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <Th<Image> label="Name" k="ref" sort={sort} dir={dir} onSort={onSort} />
              <Th<Image> label="Status" k="inUse" sort={sort} dir={dir} onSort={onSort} />
              <th>Created</th>
              <Th<Image> label="Size" k="size" sort={sort} dir={dir} onSort={onSort} num />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id + i.ref}>
                <td>
                  <button className="link" onClick={() => setInspect(i)}>{i.ref}</button>
                  <small className="mono">{i.id.replace("sha256:", "").slice(0, 12)}</small>
                </td>
                <td><span className={`tag ${i.inUse ? "ok" : ""}`}>{i.inUse ? "In use" : "Unused"}</span></td>
                <td className="muted">{i.created}</td>
                <td className="num">{formatSize(i.size)}</td>
                <td className="actions">
                  <button className="icon" title="Run" onClick={() => setRunImage(i)}>▶</button>
                  <button className="icon" title="Add tag" onClick={() => setTagImage(i)}>🏷</button>
                  <button className="icon" title="Export to a .tar file" onClick={() => void exportImage(i)}>⭳</button>
                  <button className="icon danger" title="Delete" onClick={() => void remove(i)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty>{images.loading ? "Loading…" : all.length ? "No images match your filters." : "No images. Pull one to get started."}</Empty>}
      </div>

      {asking === "pull" && (
        <TextPrompt
          title="Pull image"
          label="Image"
          placeholder="e.g. nginx:latest"
          action="Pull"
          onClose={() => setAsking(null)}
          onSubmit={(v) => {
            setAsking(null);
            setPull(v);
          }}
        />
      )}
      {pull && <StreamModal title={`Pulling ${pull}`} kind="pull" target={pull} onClose={() => { setPull(null); reload(); }} onEnd={reload} />}
      {runImage && <RunDialog image={runImage.id} label={runImage.ref} onClose={() => setRunImage(null)} onDone={reload} />}
      {tagImage && (
        <TextPrompt
          title={`Add tag to ${tagImage.ref}`}
          label="New tag"
          placeholder="e.g. myapp:v2"
          action="Tag"
          onClose={() => setTagImage(null)}
          onSubmit={(v) => {
            const src = tagImage;
            setTagImage(null);
            void app.act(`Tag ${src.ref} as ${v}`, () => api.imageTag(src.id, v), reload);
          }}
        />
      )}
      {inspect && <ImageDetail image={inspect} onClose={() => setInspect(null)} />}
      {job && <StreamModal title={job.title} kind={job.kind} target={job.target} context={job.context} onClose={() => { setJob(null); reload(); }} onEnd={reload} />}
    </section>
  );
}

export function TextPrompt({ title, label, placeholder, action, onClose, onSubmit }: {
  title: string;
  label: string;
  placeholder?: string;
  action: string;
  onClose(): void;
  onSubmit(value: string): void;
}) {
  const [v, setV] = useState("");
  const ok = v.trim().length > 0;
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSubmit(v.trim());
        }}
      >
        <label>{label}<input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} spellCheck={false} /></label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!ok}>{action}</button>
        </div>
      </form>
    </Modal>
  );
}
