// What a clean-up would reclaim. Pure functions over the parsed docker listings.

import {
  toContainers, toImages,
  type CacheRecord, type Row, type Volume,
} from "./docker";

export type CleanupKey = "containers" | "images" | "volumes" | "cache";

export interface CleanupData {
  containerRows: Row[];
  imageRows: Row[];
  volumes: Volume[];
  cache: CacheRecord[];
}

export interface CleanupItem {
  key: CleanupKey;
  label: string;
  hint: string;
  count: number;
  /** Bytes known to be freed; null when Docker does not report a size (containers). */
  bytes: number | null;
  /** Deleting this loses data that cannot be recreated (volumes). */
  risky: boolean;
}

/** Order matters: containers go first so the images and volumes they held become unused. */
export const CLEANUP_ORDER: CleanupKey[] = ["containers", "images", "volumes", "cache"];

const ACTIVE = new Set(["running", "paused", "restarting"]);

export function cleanupItems(d: CleanupData, selected: ReadonlySet<CleanupKey>): CleanupItem[] {
  const all = toContainers(d.containerRows);
  const stopped = all.filter((c) => !ACTIVE.has(c.state));
  // `image prune -a` skips images used by any container, but stopped ones are removed first when selected.
  const keep = selected.has("containers") ? all.filter((c) => ACTIVE.has(c.state)) : all;
  const unusedImages = toImages(d.imageRows, keep).filter((i) => !i.inUse);
  const unusedVolumes = d.volumes.filter((v) => v.links === 0);
  const cache = d.cache.filter((c) => !c.inUse);
  const sum = (xs: { size: number }[]) => xs.reduce((n, x) => n + x.size, 0);
  return [
    { key: "containers", label: "Stopped containers", hint: "Containers that are not running. Their writable layers are lost.", count: stopped.length, bytes: null, risky: false },
    { key: "images", label: "Unused images", hint: "Images no container uses. They can be pulled or rebuilt again.", count: unusedImages.length, bytes: sum(unusedImages), risky: false },
    { key: "volumes", label: "Unused volumes", hint: "Volumes no container uses. Their data is permanently deleted.", count: unusedVolumes.length, bytes: sum(unusedVolumes), risky: true },
    { key: "cache", label: "Build cache", hint: "Cached build steps. The next builds are slower.", count: cache.length, bytes: sum(cache), risky: false },
  ];
}

/** Bytes freed by the selected items (containers have no known size and count as 0). */
export function reclaimable(items: CleanupItem[], selected: ReadonlySet<CleanupKey>): number {
  return items.filter((i) => selected.has(i.key)).reduce((n, i) => n + (i.bytes ?? 0), 0);
}

/** Selected keys in the order they must run. */
export function runOrder(selected: ReadonlySet<CleanupKey>): CleanupKey[] {
  return CLEANUP_ORDER.filter((k) => selected.has(k));
}
