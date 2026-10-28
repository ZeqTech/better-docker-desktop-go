import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { THEMES, DEFAULTS, accentFor, saveSettings, type Settings } from "./settings";

interface SettingsApi {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  reset(): void;
}

const Ctx = createContext<SettingsApi>({ settings: DEFAULTS, update: () => {}, reset: () => {} });

export const useSettings = () => useContext(Ctx);

/** Applies the theme, accent colour and density to the document and persists every change. */
export function SettingsProvider({ initial, children }: { initial: Settings; children: ReactNode }) {
  const [settings, setSettings] = useState(initial);

  useEffect(() => {
    const a = accentFor(settings.theme, settings.accent);
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(THEMES[settings.theme].vars)) root.setProperty(k, v);
    root.setProperty("--accent", a.accent);
    root.setProperty("--accent-hi", a.hi);
    root.setProperty("--accent-soft", a.soft);
    document.documentElement.classList.toggle("compact", settings.compact);
    saveSettings(settings);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setSettings((s) => ({ ...DEFAULTS, dockerPath: s.dockerPath })), []);
  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
