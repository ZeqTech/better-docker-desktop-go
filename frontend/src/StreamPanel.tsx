import { memo, useEffect, useRef, useState } from "react";
import { errorText, startStream, type StreamKind } from "./api";
import { parseLine } from "./logs";
import { useSettings } from "./SettingsContext";
import { Modal } from "./ui";

const MAX_LINES = 5000;

/** One coloured log line; memoised so appending lines does not re-parse the old ones. */
const LogLine = memo(function LogLine({ line, showTs }: { line: string; showTs: boolean }) {
  const p = parseLine(line);
  return (
    <div className={`ll${p.level ? ` lv-${p.level}` : ""}`}>
      {showTs && p.ts && <span className="ts">{p.ts}</span>}
      <span className="msg">
        {p.segments.length === 0 ? " " : p.segments.map((s, i) => (s.cls ? <span key={i} className={s.cls}>{s.text}</span> : s.text))}
      </span>
    </div>
  );
});

/** Plain text of a line for copying, honouring the timestamp toggle. */
function copyText(line: string, showTs: boolean): string {
  const p = parseLine(line);
  return (showTs && p.ts ? `${p.ts} ` : "") + p.segments.map((s) => s.text).join("");
}

type State = "running" | "waiting" | "done" | "failed" | "stopped";
const LABEL: Record<State, string> = { running: "Running", waiting: "Waiting for container", done: "Finished", failed: "Failed", stopped: "Stopped" };

/**
 * Live output of `docker logs -f`, `pull` or `build`. Starts on mount, stops on unmount.
 * With `reattach` (container logs) the panel follows the container across stops and restarts:
 * when the stream ends it waits until `active` is true, then continues from where it left off.
 */
export function StreamPanel({ kind, target, context = "", onEnd, reattach = false, active = true }: {
  kind: StreamKind;
  target: string;
  context?: string;
  onEnd?(code: number | null): void;
  reattach?: boolean;
  active?: boolean;
}) {
  const { settings } = useSettings();
  const { logTail, logTimestamps, logWrap } = settings;
  const { update } = useSettings();
  // Pull/build output has no Docker timestamps to show.
  const isLogs = kind === "logs" || kind === "kubelogs";
  const showTs = isLogs && logTimestamps;
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<State>("running");
  const [follow, setFollow] = useState(true);
  const [run, setRun] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | null>(null);
  const since = useRef<string | null>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    let cancelled = false;
    let buf: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const resume = since.current;
    let marked = false;
    // Batch lines so a chatty container cannot flood React with one render per line.
    const flush = () => {
      timer = null;
      const batch = buf;
      buf = [];
      if (batch.length) setLines((prev) => [...prev, ...batch].slice(-MAX_LINES));
    };
    if (resume === null) setLines([]);
    setState("running");
    startStream(kind, target, context, {
      onLine: (l) => {
        if (resume !== null && !marked) {
          marked = true;
          buf.push("──────── container restarted ────────");
        }
        buf.push(l);
        if (!timer) timer = setTimeout(flush, 50);
      },
      onEnd: (code) => {
        if (timer) clearTimeout(timer);
        flush();
        if (cancelled) return;
        if (reattach) {
          // Continue from just before the stream ended so nothing logged during a restart is lost.
          since.current = new Date(Date.now() - 1000).toISOString();
          setState("waiting");
        } else {
          setState(code === 0 || code === null ? "done" : "failed");
        }
        endRef.current?.(code);
      },
    // Always request timestamps: the toggle only hides them, so flipping it needs no reload.
    }, { tail: logTail, timestamps: true, since: resume ?? undefined })
      .then((s) => {
        if (cancelled) s();
        else stop.current = s;
      })
      .catch((e) => {
        if (!cancelled) {
          setLines([errorText(e)]);
          setState("failed");
        }
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stop.current?.();
      stop.current = null;
    };
  }, [kind, target, context, run, logTail, reattach]);

  // The container stopped: end the follow right away and keep the lines already shown.
  useEffect(() => {
    if (!reattach || active || state !== "running") return;
    stop.current?.();
    stop.current = null;
    since.current = new Date(Date.now() - 1000).toISOString();
    setState("waiting");
  }, [reattach, active, state]);

  // After the stream ended, reconnect shortly after the container is running again.
  useEffect(() => {
    if (state !== "waiting" || !active) return;
    const t = setTimeout(() => setRun((n) => n + 1), 1500);
    return () => clearTimeout(t);
  }, [state, active]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  return (
    <div className="stream">
      <div className="toolbar">
        <span className={`pill ${state}`}>
          {reattach && state === "waiting" ? (active ? "Reconnecting…" : "Container stopped") : LABEL[state]}
        </span>
        <span className="spacer" />
        {isLogs && (
          <label className="check"><input type="checkbox" checked={logTimestamps} onChange={(e) => update({ logTimestamps: e.target.checked })} /> Timestamps</label>
        )}
        <label className="check"><input type="checkbox" checked={logWrap} onChange={(e) => update({ logWrap: e.target.checked })} /> Wrap</label>
        <label className="check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>
        <button onClick={() => navigator.clipboard?.writeText(lines.map((l) => copyText(l, showTs)).join("\n"))}>Copy</button>
        <button onClick={() => setLines([])}>Clear</button>
        {state === "running" || state === "waiting" ? (
          <button onClick={() => { stop.current?.(); stop.current = null; since.current = null; setState("stopped"); }}>Stop</button>
        ) : (
          <button onClick={() => { since.current = null; setRun((n) => n + 1); }}>Restart</button>
        )}
      </div>
      <div className={`logbox logview${logWrap ? " wrap" : ""}`} ref={box}>
        {lines.length
          ? lines.map((l, i) => <LogLine key={i} line={l} showTs={showTs} />)
          : <div className="ll lv-debug">{state === "running" || state === "waiting" ? "Waiting for output…" : "No output."}</div>}
      </div>
    </div>
  );
}

export function StreamModal({ title, kind, target, context, onClose, onEnd }: {
  title: string;
  kind: StreamKind;
  target: string;
  context?: string;
  onClose(): void;
  onEnd?(code: number | null): void;
}) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <StreamPanel kind={kind} target={target} context={context} onEnd={onEnd} />
    </Modal>
  );
}
