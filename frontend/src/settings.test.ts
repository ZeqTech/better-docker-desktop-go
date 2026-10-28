import { describe, expect, it } from "vitest";
import { DEFAULTS, accentIds, checkEngineJson, parseSettings, pollMs } from "./settings";

describe("parseSettings", () => {
  it("returns defaults for missing or broken input", () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings("{nope")).toEqual(DEFAULTS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULTS);
  });
  it("keeps valid fields and drops invalid ones", () => {
    const s = parseSettings(
      JSON.stringify({ autoStartEngine: false, refreshSeconds: 10, logTail: 1234, accent: "crimson", startPage: "volumes", compact: "yes", dockerPath: 5 }),
    );
    expect(s.autoStartEngine).toBe(false);
    expect(s.refreshSeconds).toBe(10);
    expect(s.logTail).toBe(DEFAULTS.logTail); // 1234 is not an allowed choice
    expect(s.accent).toBe("crimson");
    expect(s.startPage).toBe("volumes");
    expect(s.compact).toBe(DEFAULTS.compact);
    expect(s.dockerPath).toBe("");
  });
  it("defaults the map to 60 seconds and accepts only listed intervals", () => {
    expect(DEFAULTS.mapRefreshSeconds).toBe(60);
    expect(parseSettings(JSON.stringify({ mapRefreshSeconds: 30 })).mapRefreshSeconds).toBe(30);
    expect(parseSettings(JSON.stringify({ mapRefreshSeconds: 0 })).mapRefreshSeconds).toBe(0);
    expect(parseSettings(JSON.stringify({ mapRefreshSeconds: 7 })).mapRefreshSeconds).toBe(60);
  });
  it("remembers the log wrap choice", () => {
    expect(DEFAULTS.logWrap).toBe(true);
    expect(parseSettings(JSON.stringify({ logWrap: false })).logWrap).toBe(false);
    expect(parseSettings(JSON.stringify({ logWrap: "no" })).logWrap).toBe(true);
  });
  it("rejects unknown accents and pages", () => {
    const s = parseSettings(JSON.stringify({ accent: "teal", startPage: "networks" }));
    expect(s.accent).toBe("burgundy");
    expect(s.startPage).toBe("last");
  });
});

describe("themes", () => {
  it("defaults to ruby and accepts known themes", () => {
    expect(DEFAULTS.theme).toBe("ruby");
    expect(parseSettings(JSON.stringify({ theme: "emerald", accent: "jade" }))).toMatchObject({ theme: "emerald", accent: "jade" });
    expect(parseSettings(JSON.stringify({ theme: "teal" })).theme).toBe("ruby");
  });
  it("falls back to the theme's first accent when the accent belongs to another theme", () => {
    const s = parseSettings(JSON.stringify({ theme: "sapphire", accent: "crimson" }));
    expect(s.accent).toBe(accentIds("sapphire")[0]);
    expect(parseSettings(JSON.stringify({ accent: "azure" })).accent).toBe("burgundy");
  });
});

describe("helpers", () => {
  it("converts refresh seconds to ms", () => {
    expect(pollMs({ ...DEFAULTS, refreshSeconds: 3 })).toBe(3000);
    expect(pollMs({ ...DEFAULTS, refreshSeconds: 0 })).toBe(0);
    expect(pollMs({ ...DEFAULTS, refreshSeconds: 3 }, 2)).toBe(6000);
  });
  it("checks engine json", () => {
    expect(checkEngineJson("")).toBeNull();
    expect(checkEngineJson('{"debug": true}')).toBeNull();
    expect(checkEngineJson("[1]")).not.toBeNull();
    expect(checkEngineJson("{oops")).not.toBeNull();
  });
});
