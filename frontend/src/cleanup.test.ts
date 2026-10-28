import { describe, expect, it } from "vitest";
import { cleanupItems, reclaimable, runOrder, type CleanupData, type CleanupKey } from "./cleanup";

const data: CleanupData = {
  containerRows: [
    { ID: "aaaaaaaaaaaa1", Names: "web", Image: "app:1", State: "running" },
    { ID: "bbbbbbbbbbbb1", Names: "old", Image: "legacy:1", State: "exited" },
  ],
  imageRows: [
    { ID: "sha256:111111111111", Repository: "app", Tag: "1", Size: "100MB" },
    { ID: "sha256:222222222222", Repository: "legacy", Tag: "1", Size: "200MB" },
    { ID: "sha256:333333333333", Repository: "orphan", Tag: "1", Size: "50MB" },
  ],
  volumes: [
    { name: "used", driver: "local", size: 10e6, links: 1, mountpoint: "", anonymous: false },
    { name: "spare", driver: "local", size: 30e6, links: 0, mountpoint: "", anonymous: false },
  ],
  cache: [
    { id: "c1", type: "regular", description: "", inUse: false, size: 5e6, lastUsed: "", usage: 1 },
    { id: "c2", type: "regular", description: "", inUse: true, size: 9e6, lastUsed: "", usage: 1 },
  ],
};

const sel = (...k: CleanupKey[]) => new Set<CleanupKey>(k);
const get = (items: ReturnType<typeof cleanupItems>, k: CleanupKey) => items.find((i) => i.key === k)!;

describe("cleanupItems", () => {
  it("counts what is unused right now", () => {
    const items = cleanupItems(data, sel());
    expect(get(items, "containers")).toMatchObject({ count: 1, bytes: null });
    expect(get(items, "images")).toMatchObject({ count: 1, bytes: 50e6 }); // legacy is held by the stopped container
    expect(get(items, "volumes")).toMatchObject({ count: 1, bytes: 30e6, risky: true });
    expect(get(items, "cache")).toMatchObject({ count: 1, bytes: 5e6 });
  });
  it("also frees images held only by stopped containers when those are cleaned", () => {
    const items = cleanupItems(data, sel("containers"));
    expect(get(items, "images")).toMatchObject({ count: 2, bytes: 250e6 });
  });
});

describe("reclaimable and runOrder", () => {
  it("sums only the selected items", () => {
    const s = sel("images", "cache");
    expect(reclaimable(cleanupItems(data, s), s)).toBe(55e6);
    expect(reclaimable(cleanupItems(data, sel()), sel())).toBe(0);
  });
  it("runs containers before images and volumes", () => {
    expect(runOrder(sel("cache", "volumes", "containers", "images"))).toEqual(["containers", "images", "volumes", "cache"]);
  });
});
