import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environmentMatchGlobs: [
      ["src/components/**", "happy-dom"],
      ["src/hooks/**", "happy-dom"],
      ["src/app/**", "happy-dom"],
      ["src/store/**", "happy-dom"],
      ["src/styles/**", "happy-dom"],
      ["src/**", "node"],
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      // Floor against the current ~65% baseline; tighten as hotspots shrink.
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 55,
        branches: 50,
      },
    },
  },
});
