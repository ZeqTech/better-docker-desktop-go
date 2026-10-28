import { defineConfig } from "vitest/config";

// Tests run without the Wails plugin, which needs generated bindings.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
