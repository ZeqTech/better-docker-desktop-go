import { useCallback, useState } from "react";
import { api, errorText } from "./api";
import { FileBrowser } from "./FileBrowser";
import { describePreview } from "./files";
import { StreamModal } from "./StreamPanel";
import { Empty, Modal, useData } from "./ui";

/**
 * The tiny image the app offers to pull when no alpine or busybox image exists locally. It is pinned
 * by digest so a changed tag cannot swap in different content. To update it, pull `alpine:3`, read the
 * new digest from `docker images --digests alpine`, and paste it here.
 */
const HELPER_TO_PULL = "alpine:3@sha256:c6b073f8e9e58d881f6ffba6ebf3b9ebd60b9e7d6e8337018c0e68bb5c356873";
const HELPER_LABEL = "alpine:3";

/**
 * Read-only browsing of a volume. Docker cannot list a volume directly, so a throwaway container
 * (alpine or busybox, no network, no capabilities, volume mounted read-only) runs `ls` and `head`.
 */
export function VolumeFiles({ volume }: { volume: string }) {
  const helper = useData(api.volumeHelperImage);
  const [pulling, setPulling] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const image = helper.data ?? null;
  const list = useCallback((path: string) => api.volumeLs(volume, image ?? "", path), [volume, image]);

  if (helper.loading) return <Empty>Checking for a helper image…</Empty>;

  if (!image) {
    return (
      <div className="helper-prompt">
        <p>
          Docker cannot list a volume directly. To read this one the app runs a short-lived container from a tiny image
          (<code>alpine</code> or <code>busybox</code>), with the volume mounted read-only, no network and no write access.
        </p>
        <p className="muted">None is on this computer yet. Pulling <code>{HELPER_LABEL}</code> (a fixed, verified version) downloads about 8 MB once.</p>
        <button className="primary" onClick={() => setPulling(true)}>Pull {HELPER_LABEL}</button>
        {helper.error && <div className="banner">{helper.error}</div>}
        {pulling && (
          <StreamModal
            title={`Pulling ${HELPER_LABEL}`}
            kind="pull"
            target={HELPER_TO_PULL}
            onClose={() => {
              setPulling(false);
              void helper.reload();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <FileBrowser
        list={list}
        intro={<p className="muted note">Read-only view through a temporary <code>{image}</code> container. Nothing in the volume can be changed from here.</p>}
        onOpenFile={(_e, full) => setViewing(full)}
      />
      {viewing && <FileViewer volume={volume} image={image} path={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function FileViewer({ volume, image, path, onClose }: { volume: string; image: string; path: string; onClose(): void }) {
  const file = useData(async () => describePreview(await api.volumeRead(volume, image, path)));
  const p = file.data;
  return (
    <Modal title={path} onClose={onClose} wide>
      {file.error ? (
        <div className="banner">{errorText(file.error)}</div>
      ) : file.loading || !p ? (
        <Empty>Reading…</Empty>
      ) : p.binary ? (
        <Empty>Binary file: not shown.</Empty>
      ) : (
        <>
          <pre className="logbox">{p.text || "(empty file)"}</pre>
          {p.truncated && <p className="muted note">Showing the first 64 KB only.</p>}
        </>
      )}
    </Modal>
  );
}
