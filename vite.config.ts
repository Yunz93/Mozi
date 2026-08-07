import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { cspDevPlugin } from "./src/utils/vitePlugins/cspDevPlugin";
import { copyExcalidrawFontsPlugin } from "./src/utils/vitePlugins/copyExcalidrawFontsPlugin";

export default defineConfig(({ mode }) => {
  const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;
  const analyzeBundle =
    process.env.ANALYZE === "1" || process.env.ANALYZE === "true";

  return {
    server: {
      port: 3000,
      host: "localhost",
    },
    publicDir: "public",
    plugins: [
      react(),
      cspDevPlugin(),
      copyExcalidrawFontsPlugin(),
      analyzeBundle &&
        visualizer({
          filename: "dist/stats.html",
          gzipSize: true,
          brotliSize: true,
          open: false,
        }),
    ].filter(Boolean),
    define: {
      __DEV__: mode === "development",
      __PROD__: mode === "production",
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    optimizeDeps: {
      exclude: ["@huggingface/transformers"],
    },
    // Tauri 构建配置
    build: {
      target: "esnext",
      outDir: "dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 1800,
      // Generate source maps for debugging
      sourcemap: mode === "development",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (id.includes("/shiki/dist/langs/")) {
              return `shiki-lang-${path.basename(id, ".mjs")}`;
            }

            if (id.includes("/@codemirror/") || id.includes("/@lezer/")) {
              return "editor-vendor";
            }

            if (id.includes("/dompurify/")) {
              return "sanitizer-vendor";
            }

            if (
              id.includes("/markdown-it") ||
              id.includes("/katex/") ||
              id.includes("/github-markdown-css/")
            ) {
              return "markdown-vendor";
            }

            if (id.includes("/shiki/") || id.includes("/@shikijs/")) {
              return "shiki-vendor";
            }

            if (id.includes("/beautiful-mermaid/")) {
              return "beautiful-mermaid-vendor";
            }

            if (id.includes("/cytoscape/") || id.includes("/cytoscape-")) {
              return "mermaid-cytoscape-vendor";
            }

            if (id.includes("/roughjs/")) {
              return "mermaid-render-vendor";
            }

            if (id.includes("/mermaid/") || id.includes("/mermaid-")) {
              return "mermaid-vendor";
            }

            // Do NOT force @excalidraw into a shared manual chunk.
            // Putting the whole package in one sync-preloaded vendor chunk
            // creates a circular init (TDZ: "Cannot access 'QA' before
            // initialization") and whitescreens the app on boot. Leave it to
            // dynamic import() so it stays a true async chunk.

            if (id.includes("/@google/genai/")) {
              return "ai-vendor";
            }

            if (
              id.includes("/@huggingface/transformers") ||
              id.includes("/onnxruntime-web/")
            ) {
              return "embedding-vendor";
            }

            if (id.includes("/@tauri-apps/")) {
              return "tauri-vendor";
            }

            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "react-vendor";
            }

            return undefined;
          },
        },
      },
    },
    // Base path: absolute for Tauri builds (custom protocol), relative for web builds
    base: isTauri ? "/" : "./",
  };
});
