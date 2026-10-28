import { describe, expect, it } from "vitest";
import {
  actionsFor, cleanLayerCommand, formatDuration, formatSize, groupByProject, hostPorts, labelValue, matches, moveProject, orderGroups,
  parseDiskUsage, parseLines, parseSize, shortId, sortRows, stripAnsi, timeAgo, toBuilds, toContainers, toImages, toLayers,
  type Row,
} from "./docker";

describe("parseLines", () => {
  it("reads json lines and skips junk", () => {
    expect(parseLines('{"a":"1"}\n\nnot json\n{"a":"2"}\n')).toEqual([{ a: "1" }, { a: "2" }]);
  });
  it("reads arrays and empty input", () => {
    expect(parseLines('[{"a":"1"}]')).toEqual([{ a: "1" }]);
    expect(parseLines("  ")).toEqual([]);
  });
});

describe("sizes", () => {
  it("parses docker units", () => {
    expect(parseSize("0B")).toBe(0);
    expect(parseSize("374MB")).toBe(374e6);
    expect(parseSize("1.16GB")).toBe(1.16e9);
    expect(parseSize("12.3kB")).toBe(12300);
    expect(parseSize("N/A")).toBe(0);
  });
  it("formats bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(374e6)).toBe("374 MB");
    expect(formatSize(1.16e9)).toBe("1.2 GB");
  });
});

describe("durations and times", () => {
  it("formats durations", () => {
    expect(formatDuration(4.2)).toBe("4.2s");
    expect(formatDuration(75)).toBe("1m 15s");
    expect(formatDuration(3700)).toBe("1h 1m");
    expect(formatDuration(NaN)).toBe("-");
  });
  it("formats relative time", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    expect(timeAgo(new Date("2026-10-21T11:00:00Z"), now)).toBe("1 hour ago");
    expect(timeAgo(new Date("2026-10-18T12:00:00Z"), now)).toBe("3 days ago");
    expect(timeAgo(new Date("2026-10-21T11:59:50Z"), now)).toBe("just now");
  });
});

describe("containers", () => {
  const rows: Row[] = [
    { ID: "4d567390743dfull", Names: "waloo-api-1", Image: "waloo-api", State: "running", Status: "Up 2 hours",
      Ports: "0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp", RunningFor: "3 days ago",
      Labels: "a=b,com.docker.compose.project=waloo,c=d" },
    { ID: "aaaaaaaaaaaa", Names: "solo", Image: "nginx", State: "exited", Status: "Exited (0)", Ports: "", Labels: "" },
  ];
  it("merges stats and reads the compose project", () => {
    const list = toContainers(rows, [{ ID: "4d567390743d", CPUPerc: "1.50%", MemUsage: "10MiB / 2GiB" }]);
    expect(list[0]).toMatchObject({ name: "waloo-api-1", project: "waloo", cpu: 1.5, mem: "10MiB" });
    expect(list[1]).toMatchObject({ project: "", cpu: null });
  });
  it("finds label values exactly", () => {
    expect(labelValue("x.project=1,project=2", "project")).toBe("2");
    expect(labelValue(undefined, "k")).toBe("");
  });
  it("extracts distinct host ports", () => {
    expect(hostPorts(rows[0].Ports)).toEqual([8000]);
    expect(hostPorts("80/tcp")).toEqual([]);
  });
  it("offers actions by state", () => {
    expect(actionsFor("running")).toContain("stop");
    expect(actionsFor("exited")).toContain("start");
    expect(actionsFor("paused")).toContain("unpause");
  });
  it("groups by project with standalone last", () => {
    const g = groupByProject(toContainers(rows));
    expect(g.map(([k]) => k)).toEqual(["waloo", ""]);
  });
});

describe("images", () => {
  it("marks images used by containers", () => {
    const containers = toContainers([{ ID: "c1", Names: "w", Image: "postgres:17-alpine", State: "running" }]);
    const imgs = toImages(
      [
        { ID: "sha256:79bd7c99e923abc", Repository: "postgres", Tag: "17-alpine", Size: "297MB", CreatedSince: "4 weeks ago" },
        { ID: "sha256:111111111111aaa", Repository: "<none>", Tag: "<none>", Size: "1MB" },
      ],
      containers,
    );
    expect(imgs[0]).toMatchObject({ ref: "postgres:17-alpine", inUse: true, size: 297e6 });
    expect(imgs[1]).toMatchObject({ ref: "111111111111", inUse: false });
  });
});

describe("disk usage", () => {
  it("parses volumes and build cache", () => {
    const du = parseDiskUsage(JSON.stringify({
      Volumes: [{ Name: "v1", Driver: "local", Size: "210.7MB", Links: "1", Labels: "com.docker.volume.anonymous=" }],
      BuildCache: [{ ID: "abc", CacheType: "regular", Description: "x", InUse: "false", Size: "5MB", UsageCount: "3" }],
    }));
    expect(du.volumes[0]).toMatchObject({ name: "v1", size: 210.7e6, links: 1, anonymous: true });
    expect(du.cache[0]).toMatchObject({ id: "abc", inUse: false, size: 5e6, usage: 3 });
  });
  it("survives bad input", () => {
    expect(parseDiskUsage("nope")).toEqual({ volumes: [], cache: [] });
  });
});

describe("builds", () => {
  it("computes durations and sorts newest first", () => {
    const b = toBuilds([
      { ref: "old", name: "api", status: "Completed", created_at: "2026-10-10T20:00:00Z", completed_at: "2026-10-10T20:00:10Z", total_steps: 14, completed_steps: 14, cached_steps: 3 },
      { ref: "new", name: "", status: "Error", created_at: "2026-10-11T20:00:00Z" },
    ] as never);
    expect(b.map((x) => x.ref)).toEqual(["new", "old"]);
    expect(b[1]).toMatchObject({ seconds: 10, cached: 3, steps: 14 });
    expect(b[0].name).toBe("(unnamed)");
    expect(b[0].seconds).toBeNaN();
  });
});

describe("table helpers", () => {
  it("sorts numbers numerically and text naturally", () => {
    const rows = [{ n: "a10", s: 5 }, { n: "a2", s: 50 }];
    expect(sortRows(rows, "n", "asc").map((r) => r.n)).toEqual(["a2", "a10"]);
    expect(sortRows(rows, "s", "desc").map((r) => r.s)).toEqual([50, 5]);
  });
  it("matches case-insensitively across fields", () => {
    expect(matches("PG", "postgres", "x")).toBe(false);
    expect(matches("POST", "postgres")).toBe(true);
    expect(matches("", "anything")).toBe(true);
  });
  it("strips ansi escapes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m plain")).toBe("red plain");
  });
  it("shortens ids", () => {
    expect(shortId("sha256:0123456789abcdef")).toBe("0123456789ab");
  });
});

describe("image layers", () => {
  it("cleans the build command", () => {
    expect(cleanLayerCommand("/bin/sh -c #(nop)  CMD [\"postgres\"]")).toBe('CMD ["postgres"]');
    expect(cleanLayerCommand("/bin/sh -c apk add   --no-cache curl")).toBe("RUN apk add --no-cache curl");
    expect(cleanLayerCommand("EXPOSE map[5432/tcp:{}]")).toBe("EXPOSE map[5432/tcp:{}]");
  });
  it("orders layers oldest first and hides missing ids", () => {
    const layers = toLayers([
      { ID: "sha256:79bd7c99e923aaaa", CreatedBy: "CMD x", Size: "0B", CreatedSince: "4 weeks ago" },
      { ID: "<missing>", CreatedBy: "/bin/sh -c apk add curl", Size: "12.5MB", CreatedSince: "4 weeks ago" },
    ]);
    expect(layers.map((l) => l.command)).toEqual(["RUN apk add curl", "CMD x"]);
    expect(layers[0]).toMatchObject({ id: "", size: 12.5e6 });
    expect(layers[1].id).toBe("79bd7c99e923");
  });
});

describe("group order", () => {
  const g = (...n: string[]): [string, never[]][] => n.map((x) => [x, []]);
  it("applies the saved order, unknown projects after, ungrouped last", () => {
    expect(orderGroups(g("a", "b", "c", ""), ["c", "a"]).map(([p]) => p)).toEqual(["c", "a", "b", ""]);
  });
  it("moves a project up or down and keeps hidden ones", () => {
    expect(moveProject(["a", "b", "c", ""], [], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveProject(["a", "b"], ["z", "a"], "a", 1)).toEqual(["b", "a", "z"]);
    expect(moveProject(["a", "b"], ["a"], "a", -1)).toEqual(["a"]);
  });
});
