import { useCallback, useEffect, useState, type ReactNode } from "react";
import { errorText } from "./api";
import { formatSize } from "./docker";
import { breadcrumbs, joinPath, parseLs, type FileEntry } from "./files";
import { Empty } from "./ui";

export interface BrowserContext {
  path: string;
  reload(): void;
}

/**
 * A folder listing with breadcrumbs. `list` returns `ls -la` text for a path; the parent decides
 * what extra toolbar buttons, row actions and file-click behaviour (if any) to add.
 */
export function FileBrowser({ list, toolbar, rowActions, onOpenFile, intro }: {
  list(path: string): Promise<string>;
  toolbar?(ctx: BrowserContext): ReactNode;
  rowActions?(e: FileEntry, ctx: BrowserContext): ReactNode;
  onOpenFile?(e: FileEntry, fullPath: string): void;
  intro?: ReactNode;
}) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(parseLs(await list(path)));
      setError("");
    } catch (e) {
      setEntries([]);
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [list, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const ctx: BrowserContext = { path, reload: () => void load() };

  return (
    <div className="files">
      {intro}
      <div className="toolbar">
        <nav className="crumbs" aria-label="Path">
          {breadcrumbs(path).map(([label, full], i, all) => (
            <span key={full}>
              <button className="link" disabled={i === all.length - 1} onClick={() => setPath(full)}>{label}</button>
              {i > 0 && i < all.length - 1 && <span className="muted">/</span>}
            </span>
          ))}
        </nav>
        <span className="spacer" />
        {toolbar?.(ctx)}
        <button onClick={() => void load()}>Refresh</button>
      </div>
      {error && <div className="banner">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Permissions</th><th>Owner</th><th className="num">Size</th><th>Modified</th>{rowActions && <th>Actions</th>}</tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.name}>
                <td>
                  <span className="file-icon" aria-hidden>{e.kind === "dir" ? "📁" : e.kind === "link" ? "↪" : "📄"}</span>
                  {e.kind === "dir" ? (
                    <button className="link" onClick={() => setPath(joinPath(path, e.name))}>{e.name}</button>
                  ) : e.kind === "file" && onOpenFile ? (
                    <button className="link" onClick={() => onOpenFile(e, joinPath(path, e.name))}>{e.name}</button>
                  ) : (
                    <span>{e.name}</span>
                  )}
                  {e.target && <small>→ {e.target}</small>}
                </td>
                <td className="mono">{e.mode}</td>
                <td className="muted">{e.owner}:{e.group}</td>
                <td className="num">{e.kind === "dir" ? "" : formatSize(e.size)}</td>
                <td className="muted">{e.modified}</td>
                {rowActions && <td className="actions">{rowActions(e, ctx)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!error && entries.length === 0 && <Empty>{loading ? "Loading…" : "This folder is empty."}</Empty>}
      </div>
    </div>
  );
}
