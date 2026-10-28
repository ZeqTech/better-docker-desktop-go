import { useMemo, useState } from "react";
import { api, errorText } from "./api";
import {
  EMPTY_FORM, loadPresets, redactSecrets, riskyMounts, savePresets, toOptions, upsertPreset, validateForm,
  type Preset, type RunForm,
} from "./runform";
import { Modal, useApp } from "./ui";

/** Run an image as a new container: name, ports, environment, volumes, restart policy, command. */
export function RunDialog({ image, label, onClose, onDone }: { image: string; label: string; onClose(): void; onDone(): void }) {
  const app = useApp();
  const [form, setForm] = useState<RunForm>(EMPTY_FORM);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [presetName, setPresetName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const problems = useMemo(() => validateForm(form), [form]);
  const risks = useMemo(() => riskyMounts(form.volumes), [form.volumes]);
  const set = <K extends keyof RunForm>(k: K, v: RunForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    // Presets are stored unencrypted, so secret values are left out and entered again each time.
    const { form: safe, redacted } = redactSecrets(form);
    const next = upsertPreset(presets, { name, form: safe });
    setPresets(next);
    savePresets(next);
    setPresetName("");
    app.notify(redacted.length ? `Saved preset "${name}" without the value of ${redacted.join(", ")}` : `Saved preset "${name}"`);
  };
  const deletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    savePresets(next);
  };

  return (
    <Modal title={`Run ${label}`} onClose={onClose} wide>
      <form
        className="form run-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (problems.length) return;
          if (risks.length) {
            const ok = await app.confirm({
              title: "Run with risky mounts?",
              body: (
                <>
                  {risks.map((r) => (
                    <span key={r.volume} style={{ display: "block", marginBottom: 6 }}>
                      <b>{r.volume}</b> {r.reason}.
                    </span>
                  ))}
                  Only continue if you trust this image completely.
                </>
              ),
              label: "Run anyway",
              danger: true,
            });
            if (!ok) return;
          }
          setBusy(true);
          try {
            await api.imageRun(toOptions(image, form));
            app.notify(`Started ${label}`);
            onDone();
            onClose();
          } catch (x) {
            setErr(errorText(x));
            setBusy(false);
          }
        }}
      >
        <div className="preset-bar">
          <select
            value=""
            onChange={(e) => {
              const p = presets.find((x) => x.name === e.target.value);
              if (p) setForm(p.form);
            }}
            aria-label="Load preset"
          >
            <option value="">{presets.length ? "Load a preset…" : "No saved presets"}</option>
            {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save current settings as…" spellCheck={false} />
          <button type="button" disabled={!presetName.trim()} onClick={savePreset}>Save preset</button>
          {presets.some((p) => p.name === presetName.trim()) && (
            <button type="button" className="danger" onClick={() => deletePreset(presetName.trim())}>Delete preset</button>
          )}
        </div>
        <div className="run-grid">
          <label>Container name (optional)<input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} spellCheck={false} /></label>
          <label>Restart policy
            <select value={form.restart} onChange={(e) => set("restart", e.target.value as RunForm["restart"])}>
              <option value="">No</option>
              <option value="unless-stopped">Unless stopped</option>
              <option value="always">Always</option>
              <option value="on-failure">On failure</option>
            </select>
          </label>
          <label>Ports (one per line)<textarea value={form.ports} onChange={(e) => set("ports", e.target.value)} placeholder={"8080:80\n5353:53/udp"} spellCheck={false} rows={3} /></label>
          <label>Environment variables (one per line; presets do not keep secret values)<textarea value={form.env} onChange={(e) => set("env", e.target.value)} placeholder={"POSTGRES_PASSWORD=secret"} spellCheck={false} rows={3} /></label>
          <label>Volumes (one per line)<textarea value={form.volumes} onChange={(e) => set("volumes", e.target.value)} placeholder={"app-data:/var/lib/app\nC:\\src:/app:ro"} spellCheck={false} rows={3} /></label>
          <label>Command (optional, replaces the image default)<textarea value={form.command} onChange={(e) => set("command", e.target.value)} placeholder={'sh -c "echo hello"'} spellCheck={false} rows={3} /></label>
        </div>
        {risks.length > 0 && (
          <ul className="warnings">
            {risks.map((r) => <li key={r.volume}><b>{r.volume}</b> {r.reason}.</li>)}
          </ul>
        )}
        {problems.length > 0 && <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {err && <pre className="logbox err">{err}</pre>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || problems.length > 0}>Run</button>
        </div>
      </form>
    </Modal>
  );
}
