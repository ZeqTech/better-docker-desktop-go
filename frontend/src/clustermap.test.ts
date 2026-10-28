import { describe, expect, it } from "vitest";
import type { KubeNode, KubePod } from "./kube";
import { CELL, detailLevel, fitLabel, fitView, layoutMap, loadColor, nodeMemory, zoomAt } from "./clustermap";

const node = (name: string) => ({ name, ready: true } as KubeNode);
const pod = (name: string, nodeName: string, ns = "default") => ({ name, namespace: ns, node: nodeName, containers: [] } as unknown as KubePod);

describe("kubemap", () => {
  it("puts pods in their node and unscheduled ones apart", () => {
    const l = layoutMap([node("a"), node("b")], [pod("p1", "a"), pod("p2", "a"), pod("p3", "b"), pod("p4", "")]);
    expect(l.boxes.map((b) => b.label)).toEqual(["a", "b", "Unscheduled"]);
    expect(l.boxes[0].pods).toHaveLength(2);
    expect(l.boxes[2].node).toBeNull();
  });

  it("keeps boxes from overlapping", () => {
    const pods = Array.from({ length: 30 }, (_, i) => pod(`p${i}`, i % 2 ? "a" : "b"));
    const l = layoutMap([node("a"), node("b"), node("c")], pods);
    for (const a of l.boxes) for (const b of l.boxes) {
      if (a === b) continue;
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart).toBe(true);
    }
    for (const b of l.boxes) for (const c of b.pods) expect(c.x + CELL).toBeLessThanOrEqual(b.w);
  });

  it("handles an empty cluster", () => {
    const l = layoutMap([], []);
    expect(l.boxes).toEqual([]);
    expect(fitView(l, 800, 600)).toEqual({ k: 1, x: 0, y: 0 });
  });

  it("fits the layout inside the viewport", () => {
    const l = layoutMap([node("a"), node("b")], []);
    const v = fitView(l, 1000, 700);
    expect(l.width * v.k).toBeLessThanOrEqual(1000);
    expect(l.height * v.k).toBeLessThanOrEqual(700);
  });

  it("zooms around the cursor and clamps", () => {
    const v = zoomAt({ k: 1, x: 0, y: 0 }, 2, 100, 50, 0.1, 10);
    expect(v).toEqual({ k: 2, x: -100, y: -50 });
    expect(zoomAt(v, 100, 0, 0, 0.1, 10).k).toBe(10);
    expect(zoomAt(v, 0.0001, 0, 0, 0.1, 10).k).toBe(0.1);
  });

  it("chooses detail from the on-screen pod size", () => {
    expect(detailLevel(0.05)).toBe("nodes");
    expect(detailLevel(0.5)).toBe("pods");
    expect(detailLevel(1.5)).toBe("names");
    expect(detailLevel(4)).toBe("containers");
  });
});

describe("kubemap labels and memory", () => {
  it("fits labels by shrinking, then truncating", () => {
    expect(fitLabel("node-1", 400)).toEqual({ text: "node-1", px: 14 });
    const mid = fitLabel("pool-abcdefgh-12345", 120);
    expect(mid.text).toBe("pool-abcdefgh-12345");
    expect(mid.px).toBeLessThan(14);
    expect(mid.px).toBeGreaterThanOrEqual(9);
    const cut = fitLabel("pool-abcdefgh-12345", 60);
    expect(cut.px).toBe(9);
    expect(cut.text.endsWith("…")).toBe(true);
    expect(fitLabel("abc", 8).text).toBe("");
  });

  it("prefers node metrics, then pod metrics, then nothing", () => {
    const n = { name: "a", memBytes: 1000 } as KubeNode;
    const ps = [{ ...pod("p1", "a"), memRequest: 100 }, { ...pod("p2", "a"), memRequest: 50 }] as KubePod[];
    expect(nodeMemory(n, ps, new Map([["a", 700]]), null)).toEqual({ capacity: 1000, used: 700, requested: 150 });
    expect(nodeMemory(n, ps, null, new Map([["default/p1", 30], ["default/p2", 20]])).used).toBe(50);
    expect(nodeMemory(n, ps, null, null).used).toBeNull();
  });

  it("colours load", () => {
    expect(loadColor(0.5)).toBe("#2f9e6b");
    expect(loadColor(0.8)).toBe("#c9a23a");
    expect(loadColor(0.95)).toBe("#d4514f");
  });
});
