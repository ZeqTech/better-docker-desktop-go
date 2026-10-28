import { useMemo, useState } from "react";
import { api } from "./api";
import { formatSize, toContainers, type Volume } from "./docker";
import { InspectView } from "./InspectView";
import { VolumeFiles } from "./VolumeFiles";
import { Empty, Modal, StatusDot, useData } from "./ui";

/** Which containers use a volume, plus raw inspect output. */
export function VolumeDetail({ volume, onClose }: { volume: Volume; onClose(): void }) {
  const [tab, setTab] = useState<"users" | "files" | "inspect">("users");
  const title = volume.anonymous ? `${volume.name.slice(0, 12)}…` : volume.name;
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="meta">
        <span>Size <b>{formatSize(volume.size)}</b></span>
        <span>Driver <b>{volume.driver}</b></span>
        <span>Status <b>{volume.links > 0 ? `used by ${volume.links} container${volume.links === 1 ? "" : "s"}` : "unused"}</b></span>
      </div>
      <div className="tabs">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Used by</button>
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>Files</button>
        <button className={tab === "inspect" ? "active" : ""} onClick={() => setTab("inspect")}>Inspect</button>
      </div>
      <div className="tab-body">
        {tab === "users" && <Users name={volume.name} />}
        {tab === "files" && <VolumeFiles volume={volume.name} />}
        {tab === "inspect" && <InspectView kind="volume" target={volume.name} />}
      </div>
    </Modal>
  );
}

function Users({ name }: { name: string }) {
  const rows = useData(() => api.volumeContainers(name));
  const containers = useMemo(() => toContainers(rows.data ?? []), [rows.data]);
  if (rows.error) return <div className="banner">{rows.error}</div>;
  if (!containers.length) return <Empty>{rows.loading ? "Loading…" : "No container uses this volume."}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Container</th><th>Image</th><th>Status</th></tr></thead>
        <tbody>
          {containers.map((c) => (
            <tr key={c.id}>
              <td><span className="namecell"><StatusDot state={c.state} />{c.name}</span></td>
              <td>{c.image}</td>
              <td>{c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
