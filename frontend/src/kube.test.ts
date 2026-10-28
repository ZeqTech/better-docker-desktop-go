import { describe, expect, it } from "vitest";
import { age, formatBytes, looksProd, memory, parseBytes, toNodeMetrics, toPodMetrics, parseItems, podState, toEvents, toNodes, toPods, toServices, toWorkloads } from "./kube";

const NOW = Date.parse("2026-10-22T12:00:00Z");

describe("kube parsing", () => {
  it("parses list items and survives garbage", () => {
    expect(parseItems('{"items":[{"a":1}]}')).toEqual([{ a: 1 }]);
    expect(parseItems("nope")).toEqual([]);
    expect(parseItems("{}")).toEqual([]);
  });

  it("formats ages like kubectl", () => {
    expect(age("2026-10-22T11:59:30Z", NOW)).toBe("30s");
    expect(age("2026-10-22T11:00:00Z", NOW)).toBe("60m");
    expect(age("2026-10-22T07:00:00Z", NOW)).toBe("5h");
    expect(age("2026-10-12T12:00:00Z", NOW)).toBe("10d");
    expect(age(undefined, NOW)).toBe("-");
  });

  it("formats memory quantities", () => {
    expect(memory("16314464Ki")).toBe("15.6 GiB");
    expect(memory("512Mi")).toBe("512 MiB");
    expect(memory("weird")).toBe("weird");
  });

  it("parses quantities", () => {
    expect(parseBytes("512Mi")).toBe(512 * 1024 ** 2);
    expect(parseBytes("1G")).toBe(1e9);
    expect(parseBytes("129e6")).toBe(129e6);
    expect(parseBytes("100")).toBe(100);
    expect(parseBytes(undefined)).toBeNaN();
    expect(formatBytes(1536 * 1024 ** 2)).toBe("1.5 GiB");
    expect(formatBytes(300 * 1024 ** 2)).toBe("300 MiB");
  });

  it("sums pod and node metrics", () => {
    const pods = toPodMetrics(JSON.stringify({ items: [{ metadata: { name: "a", namespace: "d" }, containers: [{ usage: { memory: "100Mi" } }, { usage: { memory: "50Mi" } }] }] }));
    expect(pods.get("d/a")).toBe(150 * 1024 ** 2);
    expect(toNodeMetrics(JSON.stringify({ items: [{ metadata: { name: "n1" }, usage: { memory: "2Gi" } }] })).get("n1")).toBe(2 * 1024 ** 3);
    expect(toPodMetrics("bad").size).toBe(0);
  });

  it("reads a node", () => {
    const [n] = toNodes([{
      metadata: { name: "n1", labels: { "node-role.kubernetes.io/control-plane": "" }, creationTimestamp: "2026-10-21T12:00:00Z" },
      spec: { unschedulable: true },
      status: {
        conditions: [{ type: "Ready", status: "True" }],
        addresses: [{ type: "InternalIP", address: "10.0.0.5" }],
        nodeInfo: { kubeletVersion: "v1.30.1", osImage: "Ubuntu" },
        capacity: { cpu: "4", memory: "8Gi", pods: "110" },
      },
    }], NOW);
    expect(n).toMatchObject({ name: "n1", ready: true, status: "Ready,SchedulingDisabled", roles: "control-plane", ip: "10.0.0.5", cpu: "4", memory: "8.0 GiB", age: "24h" });
  });

  it("derives pod status from container states", () => {
    const pod = (statuses: object[], extra: object = {}) => ({
      metadata: { name: "p", namespace: "d" },
      spec: { containers: [{ name: "app", image: "x" }], nodeName: "n1" },
      status: { phase: "Running", containerStatuses: statuses, ...extra },
    });
    expect(toPods([pod([{ name: "app", ready: true, restartCount: 0, state: { running: {} } }])])[0]).toMatchObject({ status: "Running", ready: "1/1", restarts: 0 });
    expect(toPods([pod([{ name: "app", ready: false, restartCount: 7, state: { waiting: { reason: "CrashLoopBackOff" } } }])])[0]).toMatchObject({ status: "CrashLoopBackOff", ready: "0/1", restarts: 7 });
    expect(toPods([{ ...pod([]), metadata: { name: "p", deletionTimestamp: "2026-10-22T11:00:00Z" } }])[0].status).toBe("Terminating");
  });

  it("maps pod status to a dot", () => {
    expect(podState("Running")).toBe("running");
    expect(podState("Pending")).toBe("paused");
    expect(podState("Init:0/1")).toBe("paused");
    expect(podState("CrashLoopBackOff")).toBe("exited");
  });

  it("reads workloads and services", () => {
    expect(toWorkloads("deployments", [{ metadata: { name: "web", namespace: "d" }, spec: { replicas: 3 }, status: { readyReplicas: 2 } }], NOW)[0]).toMatchObject({ ready: "2/3", desired: 3, label: "Deployment" });
    expect(toWorkloads("daemonsets", [{ metadata: { name: "ds" }, status: { desiredNumberScheduled: 4, numberReady: 4 } }], NOW)[0].ready).toBe("4/4");
    expect(toServices([{ metadata: { name: "s", namespace: "d" }, spec: { type: "LoadBalancer", clusterIP: "10.1.1.1", ports: [{ port: 80, nodePort: 30080, protocol: "TCP" }] }, status: { loadBalancer: { ingress: [{ ip: "1.2.3.4" }] } } }], NOW)[0]).toMatchObject({ external: "1.2.3.4", ports: "80:30080/TCP" });
  });

  it("sorts events newest first", () => {
    const ev = toEvents([
      { type: "Normal", reason: "Old", lastTimestamp: "2026-10-22T10:00:00Z", involvedObject: { kind: "Pod", name: "a" }, metadata: {} },
      { type: "Warning", reason: "New", lastTimestamp: "2026-10-22T11:00:00Z", involvedObject: { kind: "Pod", name: "b" }, metadata: {} },
    ], NOW);
    expect(ev.map((e) => e.reason)).toEqual(["New", "Old"]);
    expect(ev[0].object).toBe("pod/b");
  });

  it("spots production contexts", () => {
    expect(looksProd("do-nyc3-lyticsly-prod")).toBe(true);
    expect(looksProd("production")).toBe(true);
    expect(looksProd("docker-desktop")).toBe(false);
    expect(looksProd("reproduce")).toBe(false);
  });
});
