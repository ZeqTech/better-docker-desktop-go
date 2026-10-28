import { useMemo, useState } from "react";
import { api } from "./api";
import { formatSize, parseLines, toLayers, type Image } from "./docker";
import { InspectView } from "./InspectView";
import { Empty, Modal, useData } from "./ui";

/** Layers and raw inspect output for one image. */
export function ImageDetail({ image, onClose }: { image: Image; onClose(): void }) {
  const [tab, setTab] = useState<"layers" | "inspect">("layers");
  return (
    <Modal title={image.ref} onClose={onClose} wide>
      <div className="tabs">
        <button className={tab === "layers" ? "active" : ""} onClick={() => setTab("layers")}>Layers</button>
        <button className={tab === "inspect" ? "active" : ""} onClick={() => setTab("inspect")}>Inspect</button>
      </div>
      <div className="tab-body">
        {tab === "layers" ? <Layers image={image} /> : <InspectView kind="image" target={image.id} />}
      </div>
    </Modal>
  );
}

function Layers({ image }: { image: Image }) {
  const hist = useData(async () => parseLines(await api.imageHistory(image.id)));
  const layers = useMemo(() => toLayers(hist.data ?? []), [hist.data]);
  const biggest = Math.max(1, ...layers.map((l) => l.size));
  if (hist.error) return <div className="banner">{hist.error}</div>;
  if (!layers.length) return <Empty>{hist.loading ? "Loading…" : "No layer history."}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th className="num">#</th><th>Command</th><th className="num">Size</th><th>Created</th></tr></thead>
        <tbody>
          {layers.map((l, i) => (
            <tr key={i}>
              <td className="num muted">{i + 1}</td>
              <td className="layer-cmd" title={l.command}>
                <code>{l.command || "(empty)"}</code>
                {l.size > 0 && <span className="layer-bar" style={{ width: `${Math.max(2, (l.size / biggest) * 100)}%` }} />}
              </td>
              <td className="num">{l.size ? formatSize(l.size) : "0 B"}</td>
              <td className="muted">{l.created}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
