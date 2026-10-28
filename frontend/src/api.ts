import { call, listen } from "./platform";
import { parseLines } from "./docker";
import type { RunOptions } from "./runform";
import type { KubeStatus } from "./kube";

export interface Status {
  docker_version: string | null;
  context: string | null;
  daemon_running: boolean;
  error: string | null;
}

export interface EngineConfig {
  path: string;
  exists: boolean;
  content: string;
}

export interface StreamOptions {
  tail?: number;
  timestamps?: boolean;
  /** RFC 3339 time to continue from (logs only); replaces the tail. */
  since?: string;
}

export type PruneKind = "images" | "containers" | "volumes" | "buildcache";

export const api = {
  status: () => call<Status>("DockerStatus"),
  appVersion: () => call<string>("AppVersion"),
  volumeHelperImage: () => call<string | null>("VolumeHelperImage"),
  volumeLs: (volume: string, image: string, path: string) => call<string>("VolumeLs", volume, image, path),
  volumeRead: (volume: string, image: string, path: string) => call<string>("VolumeRead", volume, image, path),
  volumeContainers: async (name: string) => parseLines(await call<string>("VolumeContainers", name)),
  projectAction: (project: string, action: "start" | "stop" | "restart" | "down") => call<string>("ComposeProjectAction", project, action),
  imageHistory: (image: string) => call<string>("ImageHistory", image),
  containerLs: (container: string, path: string) => call<string>("ContainerLs", container, path),
  copyOut: (container: string, path: string, dest: string) => call<string>("ContainerCopyOut", container, path, dest),
  copyIn: (container: string, src: string, dest: string) => call<string>("ContainerCopyIn", container, src, dest),
  startEngine: () => call<string>("StartEngine"),
  setDockerPath: (path: string) => call("SetDockerPath", path),
  readEngineConfig: () => call<EngineConfig>("ReadEngineConfig"),
  writeEngineConfig: (content: string) => call<string>("WriteEngineConfig", content),
  containers: async () => parseLines(await call<string>("ListContainers")),
  stats: async () => parseLines(await call<string>("ContainerStats")),
  images: async () => parseLines(await call<string>("ListImages")),
  diskUsage: () => call<string>("DiskUsage"),
  buildHistory: async () => parseLines(await call<string>("BuildHistory")),
  inspect: async (kind: "container" | "image" | "volume", target: string) => {
    const raw = await call<string>("Inspect", kind, target);
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  },
  containerAction: (id: string, action: string) => call<string>("ContainerAction", id, action),
  imageRemove: (image: string, force: boolean) => call<string>("ImageRemove", image, force),
  imageTag: (source: string, target: string) => call<string>("ImageTag", source, target),
  imageRun: (opts: RunOptions) => call<string>("ImageRun", opts),
  prune: (kind: PruneKind) => call<string>("Prune", kind),
  volumeCreate: (name: string) => call<string>("VolumeCreate", name),
  volumeRemove: (name: string, force: boolean) => call<string>("VolumeRemove", name, force),
  buildHistoryRemove: (reference: string) => call<string>("BuildHistoryRemove", reference),
  kubeStatus: () => call<KubeStatus>("KubeStatus"),
  kubeGet: (context: string, kind: string, namespace: string) => call<string>("KubeGet", context, kind, namespace),
  kubeMetrics: (context: string, kind: "pods" | "nodes") => call<string>("KubeMetrics", context, kind),
  kubeShow: (context: string, mode: "describe" | "yaml", kind: string, name: string, namespace: string) =>
    call<string>("KubeShow", context, mode, kind, name, namespace),
  kubeAct: (context: string, action: string, kind: string, name: string, namespace: string) =>
    call<string>("KubeAct", context, action, kind, name, namespace),
};

export type StreamKind = "logs" | "pull" | "build" | "events" | "stats" | "save" | "load" | "kubelogs";

export interface StreamHandlers {
  onLine(line: string): void;
  onEnd(code: number | null): void;
}

/** Start a streaming command; resolves to a stop function. */
export async function startStream(
  kind: StreamKind,
  target: string,
  context: string,
  h: StreamHandlers,
  opts: StreamOptions = {},
): Promise<() => void> {
  const id = crypto.randomUUID();
  const offs: (() => void)[] = [];
  const cleanup = () => {
    offs.splice(0).forEach((f) => f());
  };
  offs.push(
    await listen<{ id: string; line: string }>("stream-line", (p) => {
      if (p.id === id) h.onLine(p.line);
    }),
    await listen<{ id: string; code: number | null }>("stream-end", (p) => {
      if (p.id === id) {
        cleanup();
        h.onEnd(p.code);
      }
    }),
  );
  try {
    await call("StartStream", id, kind, target, context, opts.tail ?? 0, opts.timestamps ?? true, opts.since ?? "");
  } catch (e) {
    cleanup();
    throw e;
  }
  return () => {
    cleanup();
    void call("StopStream", id);
  };
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
