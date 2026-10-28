import { useCallback } from "react";
import { pickFile, pickFolder } from "./platform";
import { api } from "./api";
import { FileBrowser } from "./FileBrowser";
import { joinPath, type FileEntry } from "./files";
import { Empty, useApp } from "./ui";

/** Browse a running container's filesystem and copy files in and out with `docker cp`. */
export function FilesTab({ container, running }: { container: string; running: boolean }) {
  const app = useApp();
  const list = useCallback((path: string) => api.containerLs(container, path), [container]);

  if (!running) return <Empty>Start the container to browse its files.</Empty>;

  const download = async (e: FileEntry, path: string) => {
    const dest = await pickFolder(`Save ${e.name} to…`);
    if (!dest) return;
    await app.act(`Copy ${e.name} to your computer`, () => api.copyOut(container, joinPath(path, e.name), dest));
  };

  const upload = async (path: string, reload: () => void, directory: boolean) => {
    const title = `Upload ${directory ? "folder" : "file"} into ${path}`;
    const picked = directory ? await pickFolder(title) : await pickFile({ title });
    if (!picked) return;
    await app.act(directory ? "Upload folder" : "Upload file", () => api.copyIn(container, picked, path), reload);
  };

  return (
    <FileBrowser
      list={list}
      toolbar={({ path, reload }) => (
        <>
          <button onClick={() => void upload(path, reload, false)}>Upload file…</button>
          <button onClick={() => void upload(path, reload, true)}>Upload folder…</button>
        </>
      )}
      rowActions={(e, { path }) =>
        e.kind !== "other" && <button className="icon" title="Copy to your computer" onClick={() => void download(e, path)}>⭳</button>
      }
    />
  );
}
