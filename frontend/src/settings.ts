// App settings: typed defaults, validation of stored values, persistence. No React here.

export type PageId = "containers" | "images" | "volumes" | "builds";
export type ThemeId = "ruby" | "emerald" | "sapphire";
export type AccentId =
  | "burgundy" | "crimson" | "rose" // ruby
  | "emerald" | "jade" | "forest" // emerald
  | "sapphire" | "azure" | "indigo"; // sapphire

export interface Settings {
  autoStartEngine: boolean;
  startPage: "last" | PageId;
  confirmDestructive: boolean;
  refreshSeconds: number; // 0 = manual refresh only
  mapRefreshSeconds: number; // cluster map; 0 = manual
  onlyRunning: boolean;
  logTail: number;
  logTimestamps: boolean;
  logWrap: boolean;
  notifyOnCrash: boolean;
  dockerPath: string; // empty = docker from PATH
  theme: ThemeId;
  accent: AccentId;
  compact: boolean;
}

export const DEFAULTS: Settings = {
  autoStartEngine: true,
  startPage: "last",
  confirmDestructive: true,
  refreshSeconds: 3,
  mapRefreshSeconds: 60,
  onlyRunning: false,
  logTail: 500,
  logTimestamps: true,
  logWrap: true,
  notifyOnCrash: true,
  dockerPath: "",
  theme: "ruby",
  accent: "burgundy",
  compact: false,
};

export const PAGES: PageId[] = ["containers", "images", "volumes", "builds"];
export const REFRESH_CHOICES = [0, 2, 3, 5, 10, 30];
export const MAP_REFRESH_CHOICES = [0, 15, 30, 60, 120, 300];
export const LOG_TAIL_CHOICES = [100, 500, 1000, 5000];

export interface Accent { label: string; accent: string; hi: string; soft: string }
export interface Theme {
  label: string;
  /** CSS custom properties for the surfaces, applied on the document root. */
  vars: Record<string, string>;
  accents: Partial<Record<AccentId, Accent>>;
}

export const THEMES: Record<ThemeId, Theme> = {
  ruby: {
    label: "Ruby",
    vars: {
      "--bg": "#1c0a10", "--sidebar": "#140609", "--panel": "#2b0f18", "--panel-hi": "#381521", "--line": "#4d1d2b",
      "--fg": "#f5e9eb", "--muted": "#b8929a", "--bar-a": "#7a1429", "--bar-b": "#5a0f1f", "--logo-dark": "#6b1022", "--code-bg": "#10050a",
    },
    accents: {
      burgundy: { label: "Burgundy", accent: "#b3203f", hi: "#d6304f", soft: "rgba(179, 32, 63, 0.22)" },
      crimson: { label: "Crimson", accent: "#c4122f", hi: "#ef2a4a", soft: "rgba(196, 18, 47, 0.24)" },
      rose: { label: "Rosewood", accent: "#a13a56", hi: "#c9587a", soft: "rgba(161, 58, 86, 0.25)" },
    },
  },
  emerald: {
    label: "Emerald",
    vars: {
      "--bg": "#08170f", "--sidebar": "#05100a", "--panel": "#0f261a", "--panel-hi": "#153423", "--line": "#1f4a33",
      "--fg": "#e8f5ee", "--muted": "#8fb8a2", "--bar-a": "#0f6b3f", "--bar-b": "#0a4a2b", "--logo-dark": "#0a4a2b", "--code-bg": "#04100a",
    },
    accents: {
      emerald: { label: "Emerald", accent: "#1f9d63", hi: "#2fcf84", soft: "rgba(31, 157, 99, 0.24)" },
      jade: { label: "Jade", accent: "#138a6e", hi: "#22b893", soft: "rgba(19, 138, 110, 0.24)" },
      forest: { label: "Forest", accent: "#3f8f4a", hi: "#5fbf6c", soft: "rgba(63, 143, 74, 0.25)" },
    },
  },
  sapphire: {
    label: "Sapphire",
    vars: {
      "--bg": "#0a1224", "--sidebar": "#060c19", "--panel": "#101c36", "--panel-hi": "#172848", "--line": "#223a66",
      "--fg": "#e9eefa", "--muted": "#8fa3c8", "--bar-a": "#1a3f8f", "--bar-b": "#122c66", "--logo-dark": "#122c66", "--code-bg": "#050a16",
    },
    accents: {
      sapphire: { label: "Sapphire", accent: "#2a5fd0", hi: "#4a82f0", soft: "rgba(42, 95, 208, 0.25)" },
      azure: { label: "Azure", accent: "#1b7fc4", hi: "#3aa3ec", soft: "rgba(27, 127, 196, 0.25)" },
      indigo: { label: "Indigo", accent: "#5a4fd0", hi: "#7b72f0", soft: "rgba(90, 79, 208, 0.25)" },
    },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** Accent ids offered by a theme, in display order. */
export function accentIds(theme: ThemeId): AccentId[] {
  return Object.keys(THEMES[theme].accents) as AccentId[];
}

/** Resolve an accent for a theme, falling back to the theme's first accent. */
export function accentFor(theme: ThemeId, id: AccentId): Accent {
  const t = THEMES[theme];
  return t.accents[id] ?? t.accents[accentIds(theme)[0]]!;
}

const KEY = "settings.v1";

/** Merge stored JSON over the defaults, keeping only fields that have the right type and an allowed value. */
export function parseSettings(raw: string | null): Settings {
  const out: Settings = { ...DEFAULTS };
  if (!raw) return out;
  let v: Record<string, unknown>;
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return out;
    v = p as Record<string, unknown>;
  } catch {
    return out;
  }
  const bool = (k: "autoStartEngine" | "confirmDestructive" | "onlyRunning" | "logTimestamps" | "logWrap" | "notifyOnCrash" | "compact") => {
    if (typeof v[k] === "boolean") out[k] = v[k] as boolean;
  };
  bool("autoStartEngine");
  bool("confirmDestructive");
  bool("onlyRunning");
  bool("logTimestamps");
  bool("logWrap");
  bool("notifyOnCrash");
  bool("compact");
  if (v.startPage === "last" || PAGES.includes(v.startPage as PageId)) out.startPage = v.startPage as Settings["startPage"];
  if (REFRESH_CHOICES.includes(v.refreshSeconds as number)) out.refreshSeconds = v.refreshSeconds as number;
  if (MAP_REFRESH_CHOICES.includes(v.mapRefreshSeconds as number)) out.mapRefreshSeconds = v.mapRefreshSeconds as number;
  if (LOG_TAIL_CHOICES.includes(v.logTail as number)) out.logTail = v.logTail as number;
  if (typeof v.dockerPath === "string" && v.dockerPath.length <= 500) out.dockerPath = v.dockerPath;
  if (typeof v.theme === "string" && v.theme in THEMES) out.theme = v.theme as ThemeId;
  const accents = accentIds(out.theme);
  out.accent = accents.includes(v.accent as AccentId) ? (v.accent as AccentId) : accents[0];
  return out;
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this run only */
  }
}

/** Polling interval in ms for lists; 0 disables polling. */
export function pollMs(s: Settings, base = 1): number {
  return s.refreshSeconds * 1000 * base;
}

/** Validate engine-config text as the UI types it. Returns an error message, or null when fine. */
export function checkEngineJson(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? null : "Must be a JSON object, like { }";
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid JSON";
  }
}
