import { openUrl as open } from "./platform";

/** Open a localhost URL in the default browser (the Go side refuses anything else). */
export function openUrl(url: string): Promise<void> {
  return open(url);
}
