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
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text", "text-summary", "json-summary"],
      // 全源码统计包含未被测试加载的文件，继续保留原有覆盖率门槛。
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 55,
        branches: 50,
      },
    },
  },
});
