import { defineConfig } from "vitest/config";

// Standalone so tests don't load the Cloudflare Vite plugin from vite.config.ts.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
