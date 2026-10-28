import { describe, expect, it } from "vitest";
import { cleanTime, looksSecret, parseEnv, parseInspect } from "./inspect";

const sample = JSON.stringify([
  {
    Created: "2026-10-18T03:57:27Z",
    RestartCount: 2,
    State: {
      ExitCode: 0, OOMKilled: false, StartedAt: "2026-10-22T03:18:45Z", FinishedAt: "0001-01-01T00:00:00Z",
      Health: { Status: "healthy", FailingStreak: 0, Log: [{ Start: "2026-10-22T03:18:46Z", ExitCode: 0, Output: "accepting connections\n" }] },
    },
    Config: {
      Env: ["POSTGRES_PASSWORD=s3cret", "PATH=/usr/bin:/bin", "FLAG"],
      Cmd: ["postgres"], Entrypoint: ["docker-entrypoint.sh"], WorkingDir: "/", User: "",
      Labels: { "com.docker.compose.project": "couple", a: "b" },
    },
    HostConfig: { RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 } },
    Mounts: [
      { Type: "volume", Name: "pgdata", Source: "/var/lib/docker/volumes/pgdata/_data", Destination: "/var/lib/postgresql/data", RW: true },
      { Type: "bind", Source: "C:\\src", Destination: "/app", RW: false },
    ],
    NetworkSettings: {
      Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5433" }, { HostIp: "::", HostPort: "5433" }], "9000/tcp": null },
      Networks: { couple_default: { IPAddress: "172.18.0.2", Gateway: "172.18.0.1", MacAddress: "0e:a5", Aliases: ["db"] } },
    },
  },
]);

describe("parseInspect", () => {
  const d = parseInspect(sample)!;
  it("reads environment variables sorted by key", () => {
    expect(d.env.map((e) => e.key)).toEqual(["FLAG", "PATH", "POSTGRES_PASSWORD"]);
    expect(d.env[1].value).toBe("/usr/bin:/bin");
    expect(d.env[0].value).toBe("");
  });
  it("reads mounts and writability", () => {
    expect(d.mounts).toHaveLength(2);
    expect(d.mounts[0]).toMatchObject({ type: "volume", name: "pgdata", destination: "/var/lib/postgresql/data", writable: true });
    expect(d.mounts[1].writable).toBe(false);
  });
  it("reads published and unpublished ports", () => {
    expect(d.ports).toContainEqual({ container: "5432/tcp", hostIp: "0.0.0.0", hostPort: "5433" });
    expect(d.ports).toContainEqual({ container: "9000/tcp", hostIp: "", hostPort: "" });
  });
  it("reads networks, health, restart policy and times", () => {
    expect(d.networks[0]).toMatchObject({ name: "couple_default", ip: "172.18.0.2", aliases: ["db"] });
    expect(d.health).toMatchObject({ status: "healthy", failingStreak: 0 });
    expect(d.health?.log[0].output).toBe("accepting connections");
    expect(d.restartPolicy).toBe("unless-stopped");
    expect(d.restartCount).toBe(2);
    expect(d.startedAt).toBe("2026-10-22T03:18:45Z");
    expect(d.finishedAt).toBe("");
    expect(d.command).toBe("postgres");
    expect(d.labels.map((l) => l.key)).toEqual(["a", "com.docker.compose.project"]);
  });
  it("copes with a container without health or ports", () => {
    const x = parseInspect('[{"State":{},"Config":{},"HostConfig":{},"NetworkSettings":{}}]')!;
    expect(x.health).toBeNull();
    expect(x.ports).toEqual([]);
    expect(x.restartPolicy).toBe("no");
  });
  it("rejects garbage", () => {
    expect(parseInspect("nope")).toBeNull();
    expect(parseInspect("[]")).toBeNull();
  });
});

describe("helpers", () => {
  it("masks likely secrets", () => {
    expect(looksSecret("POSTGRES_PASSWORD")).toBe(true);
    expect(looksSecret("API_KEY")).toBe(true);
    expect(looksSecret("PATH")).toBe(false);
  });
  it("cleans docker's zero time", () => {
    expect(cleanTime("0001-01-01T00:00:00Z")).toBe("");
    expect(cleanTime("2026-10-22T00:00:00Z")).toBe("2026-10-22T00:00:00Z");
  });
  it("splits env on the first equals sign", () => {
    expect(parseEnv(["A=b=c"])).toEqual([{ key: "A", value: "b=c" }]);
  });
});
