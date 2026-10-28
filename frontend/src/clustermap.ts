// Layout for the cluster map: nodes as boxes, pods as cells inside them. Pure, in world units.

import type { KubeNode, KubePod } from "./kube";

export const CELL = 60; // pod cell edge
export const GAP = 8;
const PAD = 20;
export const HEAD = 44; // room for the node title
export const NODE_GAP = 40;
const MIN_W = 300;

export interface PodCell {
  pod: KubePod;
  x: number;
  y: number;
}

export interface NodeBox {
  key: string;
  label: string;
  node: KubeNode | null; // null = pods not yet scheduled
  x: number;
  y: number;
  w: number;
  h: number;
  pods: PodCell[];
}

export interface MapLayout {
  boxes: NodeBox[];
  width: number;
  height: number;
}

export const podKey = (p: KubePod) => `${p.namespace}/${p.name}`;

/** Lay out one box per node (plus "Unscheduled" when needed) in a near-square grid. */
export function layoutMap(nodes: KubeNode[], pods: KubePod[]): MapLayout {
  const byNode = new Map<string, KubePod[]>();
  for (const p of pods) {
    const k = p.node;
    byNode.set(k, [...(byNode.get(k) ?? []), p]);
  }
  const sizes = (n: number) => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));
    return { cols, w: Math.max(MIN_W, PAD * 2 + cols * CELL + (cols - 1) * GAP), h: HEAD + PAD + rows * CELL + (rows - 1) * GAP };
  };
  const make = (key: string, label: string, node: KubeNode | null, list: KubePod[]) => {
    const sorted = [...list].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
    const { cols, w, h } = sizes(sorted.length);
    const cells = sorted.map((pod, i) => ({ pod, x: PAD + (i % cols) * (CELL + GAP), y: HEAD + Math.floor(i / cols) * (CELL + GAP) }));
    return { key, label, node, x: 0, y: 0, w, h, pods: cells } as NodeBox;
  };

  const boxes = nodes.map((n) => make(n.name, n.name, n, byNode.get(n.name) ?? []));
  const known = new Set(nodes.map((n) => n.name));
  const loose = pods.filter((p) => !known.has(p.node));
  if (loose.length) boxes.push(make("", "Unscheduled", null, loose));

  // Grid of boxes: each row as tall as its tallest box.
  const cols = Math.max(1, Math.ceil(Math.sqrt(boxes.length)));
  let y = 0;
  let width = 0;
  for (let r = 0; r * cols < boxes.length; r++) {
    const row = boxes.slice(r * cols, (r + 1) * cols);
    let x = 0;
    for (const b of row) {
      b.x = x;
      b.y = y;
      x += b.w + NODE_GAP;
    }
    width = Math.max(width, x - NODE_GAP);
    y += Math.max(...row.map((b) => b.h)) + NODE_GAP;
  }
  return { boxes, width, height: Math.max(0, y - NODE_GAP) };
}

export interface View {
  k: number; // screen px per world unit
  x: number; // screen offset
  y: number;
}

/** View that fits the whole layout in a viewport with a margin. */
export function fitView(layout: MapLayout, vw: number, vh: number, margin = 40): View {
  if (layout.width <= 0 || layout.height <= 0 || vw <= 0 || vh <= 0) return { k: 1, x: 0, y: 0 };
  const k = Math.min((vw - margin * 2) / layout.width, (vh - margin * 2) / layout.height);
  return { k, x: (vw - layout.width * k) / 2, y: (vh - layout.height * k) / 2 };
}

/** Zoom by `factor` keeping the world point under (px, py) fixed; k is clamped to [min, max]. */
export function zoomAt(v: View, factor: number, px: number, py: number, min: number, max: number): View {
  const k = Math.min(max, Math.max(min, v.k * factor));
  const f = k / v.k;
  return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
}

export type Detail = "nodes" | "pods" | "names" | "containers";

/** What to draw, from how many screen pixels one pod cell spans. */
export function detailLevel(k: number): Detail {
  const px = CELL * k;
  if (px < 10) return "nodes";
  if (px < 80) return "pods";
  if (px < 200) return "names";
  return "containers";
}

/** Fit a label into `widthPx`: shrink from `maxPx` towards `minPx`, then cut with an ellipsis. */
export function fitLabel(text: string, widthPx: number, maxPx = 14, minPx = 9): { text: string; px: number } {
  const CHAR = 0.58; // average glyph width relative to font size
  const px = Math.min(maxPx, widthPx / Math.max(1, text.length * CHAR));
  if (px >= minPx) return { text, px };
  const chars = Math.floor(widthPx / (minPx * CHAR));
  if (chars < 2) return { text: "", px: minPx };
  return { text: text.length <= chars ? text : `${text.slice(0, chars - 1)}…`, px: minPx };
}

export interface NodeMemory {
  capacity: number;
  /** Bytes in use; null when the cluster has no metrics-server. */
  used: number | null;
  /** Sum of the pods' memory requests on this node. */
  requested: number;
}

/** Memory picture of a node: live usage when metrics exist (node figure first), else requests only. */
export function nodeMemory(node: KubeNode, pods: KubePod[], nodeUsage: Map<string, number> | null, podUsage: Map<string, number> | null): NodeMemory {
  const requested = pods.reduce((n, p) => n + p.memRequest, 0);
  let used: number | null = nodeUsage?.get(node.name) ?? null;
  if (used === null && podUsage) used = pods.reduce((n, p) => n + (podUsage.get(podKey(p)) ?? 0), 0);
  return { capacity: node.memBytes, used, requested };
}

/** Bar colour for a 0..1 fill: green, amber from 75 %, red from 90 %. */
export function loadColor(fraction: number): string {
  return fraction >= 0.9 ? "#d4514f" : fraction >= 0.75 ? "#c9a23a" : "#2f9e6b";
}
