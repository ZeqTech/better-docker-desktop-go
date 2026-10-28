// Run-dialog form model: conversion to the backend options, client-side checks, saved presets.

import { looksSecret } from "./inspect";

export interface RunForm {
  name: string;
  ports: string; // one mapping per line: 8080:80
  env: string; // one KEY=VALUE per line
  volumes: string; // one name-or-path:/container/path[:ro] per line
  restart: "" | "always" | "unless-stopped" | "on-failure";
  command: string;
}

export const EMPTY_FORM: RunForm = { name: "", ports: "", env: "", volumes: "", restart: "", command: "" };

export interface RunOptions {
  image: string;
  name: string;
  ports: string[];
  env: string[];
  volumes: string[];
  restart: string;
  command: string;
}

export const lines = (s: string): string[] => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function toOptions(image: string, f: RunForm): RunOptions {
  return { image, name: f.name.trim(), ports: lines(f.ports), env: lines(f.env), volumes: lines(f.volumes), restart: f.restart, command: f.command.trim() };
}

const PORT = /^\d{1,5}:\d{1,5}(\/(tcp|udp))?$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]*=/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Same rules as the Rust side, so mistakes show up before the Run button is pressed. */
export function validateForm(f: RunForm): string[] {
  const errs: string[] = [];
  if (f.name.trim() && !NAME.test(f.name.trim())) errs.push("Name may only contain letters, digits, - _ .");
  for (const p of lines(f.ports)) {
    if (!PORT.test(p)) errs.push(`Port "${p}": use host:container, like 8080:80`);
    else if (p.split(/[:/]/).slice(0, 2).some((n) => Number(n) < 1 || Number(n) > 65535)) errs.push(`Port "${p}": numbers must be 1-65535`);
  }
  for (const e of lines(f.env)) if (!ENV.test(e)) errs.push(`Variable "${e}": use KEY=VALUE`);
  for (const v of lines(f.volumes)) {
    const parts = v.replace(/:(ro|rw)$/, "").split(":");
    const dst = parts.pop() ?? "";
    if (!dst.startsWith("/") || dst.length < 2 || parts.join(":") === "") errs.push(`Volume "${v}": use name-or-path:/container/path`);
  }
  if ((f.command.match(/"/g)?.length ?? 0) % 2 === 1) errs.push("Command has an unclosed double quote");
  return errs;
}

// ---- risky mounts -----------------------------------------------------------------------

export interface MountRisk {
  volume: string;
  reason: string;
}

const SYSTEM_DIRS = ["/etc", "/root", "/proc", "/sys", "/dev", "/boot", "/usr", "/bin", "/sbin", "/lib", "/var/run", "c:/windows"];

/**
 * Mounts that give a container far more power than a data folder: the Docker socket or pipe (control
 * of Docker, so of the whole machine), a whole drive or filesystem, or a writable system folder.
 * They are allowed, but the user is asked to confirm.
 */
export function riskyMounts(volumesText: string): MountRisk[] {
  const risks: MountRisk[] = [];
  for (const line of lines(volumesText)) {
    const readOnly = /:ro$/.test(line);
    const parts = line.replace(/:(ro|rw)$/, "").split(":");
    parts.pop(); // container path
    const src = parts.join(":").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (/docker\.sock$/.test(src) || src.includes("pipe/docker_engine")) {
      risks.push({ volume: line, reason: "gives the container control of Docker, and so of this computer" });
    } else if (src === "" || /^[a-z]:$/.test(src) || /^\/mnt\/[a-z]$/.test(src) || /^\/host_mnt\/[a-z]$/.test(src)) {
      risks.push({ volume: line, reason: "mounts a whole drive or the whole filesystem" });
    } else if (!readOnly && SYSTEM_DIRS.includes(src)) {
      risks.push({ volume: line, reason: "lets the container change a system folder" });
    }
  }
  return risks;
}
// ---- secrets ----------------------------------------------------------------------------

/** A value with credentials embedded in a URL, like postgres://user:password@host/db. */
function valueHasCredentials(v: string): boolean {
  return /:\/\/[^/\s:@]+:[^@\s]+@/.test(v);
}

/**
 * Blank out the value of every secret-looking environment variable (by name, or because the value is
 * a URL with a password in it). Presets are stored unencrypted, so they must not hold secrets.
 */
export function redactSecrets(form: RunForm): { form: RunForm; redacted: string[] } {
  const redacted: string[] = [];
  const env = form.env
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      if (i <= 0) return line;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1);
      if (value.trim() !== "" && (looksSecret(key) || valueHasCredentials(value))) {
        redacted.push(key);
        return `${key}=`;
      }
      return line;
    })
    .join("\n");
  return { form: { ...form, env }, redacted };
}

// ---- presets ----------------------------------------------------------------------------

export interface Preset {
  name: string;
  form: RunForm;
}

const KEY = "run-presets.v1";
const RESTARTS = ["", "always", "unless-stopped", "on-failure"];

const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, 5000) : "");

/** Parse stored presets, dropping anything malformed. */
export function parsePresets(raw: string | null): Preset[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: Preset[] = [];
    for (const p of v) {
      if (!p || typeof p !== "object" || typeof p.name !== "string" || !p.name.trim() || !p.form || typeof p.form !== "object") continue;
      const name = p.name.trim().slice(0, 60);
      if (seen.has(name)) continue;
      seen.add(name);
      const f = p.form as Record<string, unknown>;
      out.push({
        name,
        // Presets saved by older versions may hold secrets; strip them on load.
        form: redactSecrets({
          name: str(f.name), ports: str(f.ports), env: str(f.env), volumes: str(f.volumes),
          restart: RESTARTS.includes(f.restart as string) ? (f.restart as RunForm["restart"]) : "",
          command: str(f.command),
        }).form,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Add or replace a preset by name. */
export function upsertPreset(list: Preset[], p: Preset): Preset[] {
  const name = p.name.trim();
  return [...list.filter((x) => x.name !== name), { name, form: p.form }].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadPresets(): Preset[] {
  try {
    return parsePresets(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function savePresets(list: Preset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}
