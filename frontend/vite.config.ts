import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";

// Vite empties dist/ on every build, but Go's `//go:embed all:frontend/dist` fails on an empty or
// missing folder (a fresh clone, `go test`). Put the tracked placeholder back after each build.
const keepDist = (): Plugin => ({
  name: "keep-dist",
  closeBundle() {
    mkdirSync("dist", { recursive: true });
    writeFileSync("dist/.gitkeep", "");
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  plugins: [react(), wails("./bindings"), keepDist()],
});
