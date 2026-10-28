// The only module that talks to the Wails runtime: calls into the Go `App` service, events from
// it, native dialogs, notifications and opening links.

import { Call, Events } from "@wailsio/runtime";

/** Call an exported method of the Go `App` service (arguments are positional). */
export function call<T = void>(method: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(`main.App.${method}`, ...args) as Promise<T>;
}

/** Subscribe to a Go event. Resolves to the function that unsubscribes. */
export async function listen<T>(name: string, handler: (payload: T) => void): Promise<() => void> {
  return Events.On(name, (e) => handler(e.data as T));
}

interface Filter {
  name: string;
  extensions: string[];
}

const pattern = (filters?: Filter[]) => (filters?.[0]?.extensions ?? []).map((e) => `*.${e}`).join(";");

/** Folder chooser; null when cancelled. */
export async function pickFolder(title = "Choose a folder"): Promise<string | null> {
  return (await call<string>("PickFolder", title)) || null;
}

/** File chooser; null when cancelled. */
export async function pickFile(opts: { title?: string; filters?: Filter[] } = {}): Promise<string | null> {
  return (await call<string>("PickFile", opts.title ?? "Choose a file", opts.filters?.[0]?.name ?? "", pattern(opts.filters))) || null;
}

/** Save dialog; null when cancelled. `defaultPath` is only used for its file name. */
export async function pickSavePath(opts: { defaultPath?: string; filters?: Filter[] } = {}): Promise<string | null> {
  const name = (opts.defaultPath ?? "").split(/[\\/]/).pop() ?? "";
  return (await call<string>("SaveFilePath", name, opts.filters?.[0]?.name ?? "", pattern(opts.filters))) || null;
}

/** Desktop notification; never throws. */
export async function notify(title: string, body: string): Promise<void> {
  try {
    await call("Notify", title, body);
  } catch {
    /* notifications unavailable: the list still updates */
  }
}

/** Open a localhost URL in the default browser (the Go side refuses anything else). */
export function openUrl(url: string): Promise<void> {
  return call("OpenURL", url);
}
