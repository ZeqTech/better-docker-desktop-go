import { useEffect, useRef, useState } from "react";
import { startStream } from "./api";
import { notify } from "./platform";
import { CrashDetector, affected, parseEvent, type CrashAlert, type LoggedEvent, type Ticks } from "./events";

function sendCrashNotification(a: CrashAlert): Promise<void> {
  return notify(`${a.name} stopped`, `Container ${a.reason}.`);
}

/**
 * Follows `docker events` while the engine is up. Returns counters that change when containers,
 * images or volumes change, so views can refetch immediately instead of waiting for their poll.
 * Also keeps a short activity log and raises a desktop notification when a container dies on its own.
 */
export function useEngineEvents(up: boolean, notifyOnCrash: boolean): { ticks: Ticks; log: LoggedEvent[] } {
  const [ticks, setTicks] = useState<Ticks>({ containers: 0, images: 0, volumes: 0 });
  const [log, setLog] = useState<LoggedEvent[]>([]);
  const notifyRef = useRef(notifyOnCrash);
  notifyRef.current = notifyOnCrash;

  useEffect(() => {
    if (!up) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let flush: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<keyof Ticks>();
    let batch: LoggedEvent[] = [];
    const crashes = new CrashDetector();

    const schedule = (ms: number) => {
      if (!cancelled) retry = setTimeout(connect, ms);
    };
    const connect = () => {
      startStream("events", "", "", {
        onLine: (line) => {
          const ev = parseEvent(line);
          if (!ev) return;
          affected(ev).forEach((k) => pending.add(k));
          batch.push({ ...ev, time: Date.now() });
          if (!flush) {
            // Coalesce bursts (a compose up emits dozens of events) into one refresh.
            flush = setTimeout(() => {
              flush = null;
              const keys = [...pending];
              pending.clear();
              const added = batch;
              batch = [];
              setLog((prev) => [...prev, ...added].slice(-300));
              setTicks((t) => {
                const n = { ...t };
                keys.forEach((k) => (n[k] += 1));
                return n;
              });
            }, 250);
          }
          const alert = crashes.feed(ev);
          if (alert && notifyRef.current) void sendCrashNotification(alert);
        },
        onEnd: () => schedule(3000),
      })
        .then((s) => {
          if (cancelled) s();
          else stop = s;
        })
        .catch(() => schedule(5000));
    };
    connect();
    return () => {
      cancelled = true;
      stop?.();
      if (retry) clearTimeout(retry);
      if (flush) clearTimeout(flush);
    };
  }, [up]);

  return { ticks, log };
}
