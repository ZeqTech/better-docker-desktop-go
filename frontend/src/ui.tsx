import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Dir } from "./docker";

// ---- app context ----------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  label?: string;
  danger?: boolean;
}

export interface AppCtx {
  notify(message: string, kind?: "ok" | "error"): void;
  confirm(o: ConfirmOptions): Promise<boolean>;
  /** Run an async action, toast the outcome, then refresh. Returns true on success. */
  act(label: string, fn: () => Promise<unknown>, after?: () => void): Promise<boolean>;
}

export const Ctx = createContext<AppCtx>({
  notify: () => {},
  confirm: async () => false,
  act: async () => false,
});

export const useApp = () => useContext(Ctx);

// ---- data hook ------------------------------------------------------------------------

/** Fetch on mount, then every `interval` ms (0 = never) and whenever `trigger` changes (e.g. a Docker event). */
export function useData<T>(fetcher: () => Promise<T>, interval = 0, trigger: number | string = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(fetcher);
  ref.current = fetcher;
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const v = await ref.current();
      if (alive.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(typeof e === "string" ? e : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    if (!interval) return () => { alive.current = false; };
    const t = setInterval(() => {
      if (!document.hidden) void reload();
    }, interval);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [reload, interval]);

  // Refetch when the trigger changes, but not for the value it had on mount (that is the first fetch).
  const seen = useRef(trigger);
  useEffect(() => {
    if (trigger !== seen.current) {
      seen.current = trigger;
      void reload();
    }
  }, [trigger, reload]);

  return { data, error, loading, reload };
}

// ---- small components -----------------------------------------------------------------

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Th<T>({ label, k, sort, dir, onSort, num }: { label: string; k: keyof T; sort: keyof T; dir: Dir; onSort(k: keyof T): void; num?: boolean }) {
  return (
    <th className={`sortable${num ? " num" : ""}`} onClick={() => onSort(k)}>
      {label}
      {sort === k && <span className="arrow">{dir === "asc" ? " ▲" : " ▼"}</span>}
    </th>
  );
}

/** Sort state helper: clicking the active column flips direction. */
export function useSort<T>(initial: keyof T, dir: Dir = "asc") {
  const [sort, setSort] = useState<keyof T>(initial);
  const [d, setDir] = useState<Dir>(dir);
  const onSort = (k: keyof T) => {
    if (k === sort) setDir(d === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setDir("asc");
    }
  };
  return { sort, dir: d, onSort };
}

export function StatusDot({ state }: { state: string }) {
  return <span className={`dot ${state}`} title={state} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Summary({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="summary">
      {items.map((i) => (
        <div className="card" key={i.label}>
          <span className="card-label">{i.label}</span>
          <span className="card-value">{i.value}</span>
          {i.sub && <span className="card-sub">{i.sub}</span>}
        </div>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search" }: { value: string; onChange(v: string): void; placeholder?: string }) {
  return (
    <div className="search">
      <span aria-hidden>⌕</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
    </div>
  );
}

export function Banner({ children }: { children: ReactNode }) {
  return <div className="banner">{children}</div>;
}
