import { describe, expect, it } from "vitest";
import { EMPTY_FORM, lines, parsePresets, redactSecrets, riskyMounts, toOptions, upsertPreset, validateForm, type RunForm } from "./runform";

const form = (p: Partial<RunForm>): RunForm => ({ ...EMPTY_FORM, ...p });

describe("toOptions", () => {
  it("splits multi-line fields and drops blanks", () => {
    const o = toOptions("nginx", form({ name: " web ", ports: "8080:80\n\n 9090:90 \r\n", env: "A=1", volumes: "d:/d", command: " nginx -g x " }));
    expect(o).toEqual({ image: "nginx", name: "web", ports: ["8080:80", "9090:90"], env: ["A=1"], volumes: ["d:/d"], restart: "", command: "nginx -g x" });
    expect(lines("")).toEqual([]);
  });
});

describe("validateForm", () => {
  it("accepts a good form", () => {
    expect(validateForm(form({ name: "web-1", ports: "8080:80\n5353:53/udp", env: "A=1\nB_2=x y", volumes: "data:/d:ro\nC:\\src:/app", command: 'sh -c "echo hi"' }))).toEqual([]);
  });
  it("reports each problem", () => {
    const errs = validateForm(form({ name: "-bad", ports: "80\n99999:80", env: "nokey", volumes: "data\nx:rel", command: 'echo "oops' }));
    expect(errs).toHaveLength(7);
    expect(errs.join("\n")).toMatch(/Name/);
    expect(errs.join("\n")).toMatch(/1-65535/);
    expect(errs.join("\n")).toMatch(/unclosed/);
  });
});

describe("presets", () => {
  it("ignores malformed storage", () => {
    expect(parsePresets(null)).toEqual([]);
    expect(parsePresets("{oops")).toEqual([]);
    expect(parsePresets('{"a":1}')).toEqual([]);
    expect(parsePresets('[{"name":"","form":{}},{"x":1},{"name":"ok","form":{"ports":"1:1","restart":"weird"}}]')).toEqual([
      { name: "ok", form: { ...EMPTY_FORM, ports: "1:1" } },
    ]);
  });
  it("de-duplicates by name", () => {
    const raw = JSON.stringify([{ name: "a", form: { ports: "1:1" } }, { name: "a", form: { ports: "2:2" } }]);
    expect(parsePresets(raw)).toHaveLength(1);
  });
  it("upserts and keeps the list sorted", () => {
    let list = upsertPreset([], { name: "zeta", form: form({ ports: "1:1" }) });
    list = upsertPreset(list, { name: "alpha", form: EMPTY_FORM });
    list = upsertPreset(list, { name: "zeta", form: form({ ports: "2:2" }) });
    expect(list.map((p) => p.name)).toEqual(["alpha", "zeta"]);
    expect(list[1].form.ports).toBe("2:2");
  });
});

describe("redactSecrets", () => {
  it("blanks secret-looking values but keeps the variable", () => {
    const r = redactSecrets(form({ env: "POSTGRES_PASSWORD=hunter2\nAPI_KEY=abc\nLOG_LEVEL=debug\nAUTH_TOKEN=t" }));
    expect(r.form.env).toBe("POSTGRES_PASSWORD=\nAPI_KEY=\nLOG_LEVEL=debug\nAUTH_TOKEN=");
    expect(r.redacted).toEqual(["POSTGRES_PASSWORD", "API_KEY", "AUTH_TOKEN"]);
  });
  it("catches passwords embedded in URLs", () => {
    const r = redactSecrets(form({ env: "DATABASE_URL=postgres://app:s3cret@db:5432/app\nPUBLIC_URL=https://example.com/path" }));
    expect(r.form.env).toBe("DATABASE_URL=\nPUBLIC_URL=https://example.com/path");
    expect(r.redacted).toEqual(["DATABASE_URL"]);
  });
  it("leaves other fields, blanks and empty values alone", () => {
    const f = form({ name: "db", ports: "1:1", env: "TOKEN=\n\nNOEQUALS", command: "run" });
    const r = redactSecrets(f);
    expect(r.form).toEqual(f);
    expect(r.redacted).toEqual([]);
  });
});

describe("presets and secrets", () => {
  it("strips secrets from presets stored by older versions", () => {
    const raw = JSON.stringify([{ name: "db", form: { env: "POSTGRES_PASSWORD=old\nTZ=UTC" } }]);
    expect(parsePresets(raw)[0].form.env).toBe("POSTGRES_PASSWORD=\nTZ=UTC");
  });
});
describe("riskyMounts", () => {
  it("flags the docker socket and pipe, even read-only", () => {
    expect(riskyMounts("/var/run/docker.sock:/var/run/docker.sock").map((r) => r.reason)[0]).toMatch(/control of Docker/);
    expect(riskyMounts("/var/run/docker.sock:/s:ro")).toHaveLength(1);
    expect(riskyMounts("\\\\.\\pipe\\docker_engine:\\\\.\\pipe\\docker_engine")).toHaveLength(1);
  });
  it("flags whole drives and the filesystem root", () => {
    expect(riskyMounts("/:/host")[0].reason).toMatch(/whole drive/);
    expect(riskyMounts("C:\\:/c")[0].reason).toMatch(/whole drive/);
    expect(riskyMounts("C:/:/c")).toHaveLength(1);
    expect(riskyMounts("/mnt/c:/c:ro")).toHaveLength(1);
  });
  it("flags writable system folders but not read-only ones", () => {
    expect(riskyMounts("/etc:/e")[0].reason).toMatch(/system folder/);
    expect(riskyMounts("/etc:/e:ro")).toEqual([]);
    expect(riskyMounts("C:\\Windows:/w")).toHaveLength(1);
  });
  it("leaves ordinary mounts alone", () => {
    expect(riskyMounts("data:/var/lib/data\nC:\\src\\app:/app\n/mnt/c/src:/app\n/home/me/project:/p")).toEqual([]);
    expect(riskyMounts("")).toEqual([]);
  });
});