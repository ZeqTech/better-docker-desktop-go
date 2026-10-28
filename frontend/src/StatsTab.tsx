import { useEffect, useMemo, useState } from "react";
import { errorText, startStream } from "./api";
import { formatSize } from "./docker";
import { areaPath, linePath, niceMax, parseStatsLine, pushSample, rates, type Sample } from "./stats";
import { Empty } from "./ui";

const W = 300;
const H = 80;

function Chart({ title, value, values, max, axis, hint }: { title: string; value: string; values: number[]; max: number; axis: string; hint?: string }) {
  return (
    <div className="chart">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-value">{value}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title} over the last ${values.length} seconds`}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="grid" />)}
        <path d={areaPath(values, W, H, max)} className="area" />
        <path d={linePath(values, W, H, max)} className="line" />
      </svg>
      <div className="chart-axis"><span>{axis}</span>{hint && <span>{hint}</span>}</div>
    </div>
  );
}

/** Live CPU, memory, network and disk charts for a running container (about the last 90 seconds). */
export function StatsTab({ container, running }: { container: string; running: boolean }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    setSamples([]);
    setError("");
    startStream("stats", container, "", {
      onLine: (l) => {
        const s = parseStatsLine(l);
        if (s) setSamples((prev) => pushSample(prev, s));
      },
      onEnd: () => {},
    })
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [container, running]);

  const v = useMemo(() => {
    const times = samples.map((s) => s.t);
    return {
      cpu: samples.map((s) => s.cpu),
      mem: samples.map((s) => s.memBytes),
      net: rates(samples.map((s) => s.netRx + s.netTx), times),
      disk: rates(samples.map((s) => s.blockRead + s.blockWrite), times),
      last: samples[samples.length - 1],
    };
  }, [samples]);

  if (!running) return <Empty>Start the container to see live stats.</Empty>;
  if (error) return <Empty>{error}</Empty>;
  if (!v.last) return <Empty>Waiting for the first sample…</Empty>;

  const { last } = v;
  const cpuMax = niceMax(Math.max(...v.cpu), 5);
  const memMax = niceMax(Math.max(...v.mem), 1024 * 1024);
  const netMax = niceMax(Math.max(...v.net, 0), 1024);
  const diskMax = niceMax(Math.max(...v.disk, 0), 1024);
  const rate = (a: number[]) => `${formatSize(a[a.length - 1] ?? 0)}/s`;
  return (
    <div className="charts">
      <Chart title="CPU" value={`${last.cpu.toFixed(2)}%`} values={v.cpu} max={cpuMax} axis={`top: ${cpuMax}%`} hint="100% = one core" />
      <Chart title="Memory" value={`${formatSize(last.memBytes)} (${last.memPct.toFixed(1)}%)`} values={v.mem} max={memMax} axis={`top: ${formatSize(memMax)}`} hint={`limit ${formatSize(last.memLimit)}`} />
      <Chart title="Network" value={rate(v.net)} values={v.net} max={netMax} axis={`top: ${formatSize(netMax)}/s`} hint={`received ${formatSize(last.netRx)}, sent ${formatSize(last.netTx)}`} />
      <Chart title="Disk I/O" value={rate(v.disk)} values={v.disk} max={diskMax} axis={`top: ${formatSize(diskMax)}/s`} hint={`read ${formatSize(last.blockRead)}, written ${formatSize(last.blockWrite)}`} />
      <div className="chart-foot">{last.pids} process{last.pids === 1 ? "" : "es"}</div>
    </div>
  );
}
