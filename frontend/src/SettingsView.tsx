import { useEffect, useState, type ReactNode } from "react";
import { pickFile } from "./platform";
import { api, errorText, type Status } from "./api";
import { useSettings } from "./SettingsContext";
import {
  THEMES, THEME_IDS, accentFor, accentIds, LOG_TAIL_CHOICES, MAP_REFRESH_CHOICES, PAGES, REFRESH_CHOICES, checkEngineJson,
  type PageId,
} from "./settings";
import { SHORTCUT_HELP } from "./shortcuts";
import { useApp, useData } from "./ui";

type Section = "general" | "docker" | "appearance" | "about";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "docker", label: "Docker" },
  { id: "appearance", label: "Appearance" },
  { id: "about", label: "About" },
];

export function SettingsView({ status, onReconnect }: { status: Status | null; onReconnect(): void }) {
  const [section, setSection] = useState<Section>("general");
  return (
    <section className="view">
      <header className="view-head"><h1>Settings</h1></header>
      <div className="settings">
        <ul className="settings-nav">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button className={section === s.id ? "active" : ""} onClick={() => setSection(s.id)}>{s.label}</button>
            </li>
          ))}
        </ul>
        <div className="settings-body">
          {section === "general" && <General />}
          {section === "docker" && <DockerSettings onReconnect={onReconnect} />}
          {section === "appearance" && <Appearance />}
          {section === "about" && <About status={status} />}
        </div>
      </div>
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`switch${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function General() {
  const { settings: s, update, reset } = useSettings();
  const app = useApp();
  return (
    <>
      <h2>General</h2>
      <Row title="Start Docker Engine when the app opens" hint="Launches Docker Desktop if the engine is not running.">
        <Switch label="Start engine on launch" checked={s.autoStartEngine} onChange={(v) => update({ autoStartEngine: v })} />
      </Row>
      <Row title="Open on" hint="Page shown when the app starts.">
        <select value={s.startPage} onChange={(e) => update({ startPage: e.target.value as "last" | PageId })}>
          <option value="last">Last page used</option>
          {PAGES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </select>
      </Row>
      <Row title="Confirm before destructive actions" hint="Delete, kill and clean-up ask first. Turn off only if you accept losing data by misclick.">
        <Switch label="Confirm destructive actions" checked={s.confirmDestructive} onChange={(v) => update({ confirmDestructive: v })} />
      </Row>
      <Row title="Show only running containers by default">
        <Switch label="Only running containers" checked={s.onlyRunning} onChange={(v) => update({ onlyRunning: v })} />
      </Row>
      <Row title="Refresh lists every" hint="How often container and image lists update. Manual means use the Refresh buttons.">
        <select value={s.refreshSeconds} onChange={(e) => update({ refreshSeconds: Number(e.target.value) })}>
          {REFRESH_CHOICES.map((n) => <option key={n} value={n}>{n === 0 ? "Manual" : `${n} seconds`}</option>)}
        </select>
      </Row>
      <Row title="Refresh the cluster map every" hint="How often the Kubernetes map reloads nodes and pods.">
        <select value={s.mapRefreshSeconds} onChange={(e) => update({ mapRefreshSeconds: Number(e.target.value) })}>
          {MAP_REFRESH_CHOICES.map((n) => <option key={n} value={n}>{n === 0 ? "Manual" : n >= 60 ? `${n / 60} minute${n === 60 ? "" : "s"}` : `${n} seconds`}</option>)}
        </select>
      </Row>
      <Row title="Log history" hint="Lines loaded when you open a container's Logs tab.">
        <select value={s.logTail} onChange={(e) => update({ logTail: Number(e.target.value) })}>
          {LOG_TAIL_CHOICES.map((n) => <option key={n} value={n}>{n} lines</option>)}
        </select>
      </Row>
      <Row title="Show timestamps in logs">
        <Switch label="Log timestamps" checked={s.logTimestamps} onChange={(v) => update({ logTimestamps: v })} />
      </Row>
      <Row title="Notify when a container crashes" hint="Desktop notification when a container exits with an error or runs out of memory. Stopping a container yourself stays silent.">
        <Switch label="Crash notifications" checked={s.notifyOnCrash} onChange={(v) => update({ notifyOnCrash: v })} />
      </Row>
      <Row title="Wrap long log lines" hint="Also togglable in the Logs toolbar.">
        <Switch label="Wrap log lines" checked={s.logWrap} onChange={(v) => update({ logWrap: v })} />
      </Row>
      <div className="setting-foot">
        <button onClick={() => { reset(); app.notify("Settings reset to defaults"); }}>Reset to defaults</button>
      </div>
    </>
  );
}

function DockerSettings({ onReconnect }: { onReconnect(): void }) {
  const { settings: s, update } = useSettings();
  const app = useApp();
  const [path, setPath] = useState(s.dockerPath);
  const [pathErr, setPathErr] = useState("");

  const applyPath = async (value: string) => {
    try {
      await api.setDockerPath(value);
      update({ dockerPath: value.trim() });
      setPathErr("");
      app.notify(value.trim() ? "Using the selected Docker CLI" : "Using docker from PATH");
      onReconnect();
    } catch (e) {
      setPathErr(errorText(e));
    }
  };

  return (
    <>
      <h2>Docker</h2>
      <Row title="Docker CLI" hint="Leave empty to use docker from your PATH. Must be the docker executable itself (docker.exe on Windows), not a script.">
        <span className="path-edit">
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="docker (from PATH)" spellCheck={false} />
          <button onClick={async () => {
            const windows = /Windows/i.test(navigator.userAgent);
            const picked = await pickFile({ filters: windows ? [{ name: "docker.exe", extensions: ["exe"] }] : undefined });
            if (picked) { setPath(picked); void applyPath(picked); }
          }}>Browse…</button>
          <button className="primary" disabled={path.trim() === s.dockerPath} onClick={() => void applyPath(path)}>Apply</button>
        </span>
      </Row>
      {pathErr && <div className="banner">{pathErr}</div>}
      <EngineConfigEditor />
    </>
  );
}

function EngineConfigEditor() {
  const app = useApp();
  const cfg = useData(api.readEngineConfig);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState("");
  useEffect(() => {
    if (cfg.data) {
      setText(cfg.data.content);
      setLoaded(cfg.data.content);
    }
  }, [cfg.data]);
  const problem = checkEngineJson(text);
  const dirty = text !== loaded;

  return (
    <div className="engine-config">
      <h3>Docker Engine</h3>
      <small>
        Edits <span className="mono">{cfg.data?.path ?? "~/.docker/daemon.json"}</span>
        {cfg.data && !cfg.data.exists && " (does not exist yet; saving creates it)"}. The old file is kept as daemon.json.bak.
        Restart Docker Desktop for changes to take effect.
      </small>
      {cfg.error && <div className="banner">{cfg.error}</div>}
      <textarea
        className={`code${problem ? " bad" : ""}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Docker Engine configuration JSON"
      />
      {problem && <div className="field-error">{problem}</div>}
      <div className="form-actions">
        <button disabled={!dirty} onClick={() => setText(loaded)}>Revert</button>
        <button
          className="primary"
          disabled={!dirty || !!problem}
          onClick={() =>
            void app.act("Save engine configuration", async () => {
              const saved = await api.writeEngineConfig(text);
              setText(saved);
              setLoaded(saved);
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Appearance() {
  const { settings: s, update } = useSettings();
  return (
    <>
      <h2>Appearance</h2>
      <Row title="Theme" hint="Ruby red, emerald green or sapphire blue. Each has its own accent shades.">
        <span className="swatches">
          {THEME_IDS.map((id) => (
            <button
              key={id}
              className={`swatch${s.theme === id ? " on" : ""}`}
              style={{ background: `linear-gradient(135deg, ${THEMES[id].vars["--bar-a"]}, ${THEMES[id].vars["--bg"]})` }}
              title={THEMES[id].label}
              aria-label={THEMES[id].label}
              aria-pressed={s.theme === id}
              onClick={() => update({ theme: id, accent: accentIds(id)[0] })}
            />
          ))}
        </span>
      </Row>
      <Row title="Accent colour" hint={`Highlight shade for the ${THEMES[s.theme].label} theme.`}>
        <span className="swatches">
          {accentIds(s.theme).map((id) => (
            <button
              key={id}
              className={`swatch${s.accent === id ? " on" : ""}`}
              style={{ background: accentFor(s.theme, id).accent }}
              title={accentFor(s.theme, id).label}
              aria-label={accentFor(s.theme, id).label}
              aria-pressed={s.accent === id}
              onClick={() => update({ accent: id })}
            />
          ))}
        </span>
      </Row>
      <Row title="Compact tables" hint="Tighter rows to fit more containers on screen.">
        <Switch label="Compact tables" checked={s.compact} onChange={(v) => update({ compact: v })} />
      </Row>
    </>
  );
}

function About({ status }: { status: Status | null }) {
  const version = useData(api.appVersion);
  return (
    <>
      <h2>About</h2>
      <Row title="Better Docker Desktop">{version.data ? `v${version.data}` : ""}</Row>
      <Row title="Docker Engine">{status?.daemon_running ? status.docker_version : "Not running"}</Row>
      <Row title="Context">{status?.context ?? "-"}</Row>
      <h3 className="sub">Keyboard shortcuts</h3>
      <dl className="kv shortcuts">
        {SHORTCUT_HELP.map(([keys, what]) => (
          <div key={keys}><dt className="mono">{keys}</dt><dd>{what}</dd></div>
        ))}
      </dl>
      <p className="muted">
        This app drives the docker command line. It shows and manages containers, images, volumes and builds, and needs a running Docker Engine.
      </p>
    </>
  );
}
