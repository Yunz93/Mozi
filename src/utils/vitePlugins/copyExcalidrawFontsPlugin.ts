/**
 * Copy Excalidraw self-hosted fonts into `public/fonts` for Vite dev + build.
 * Required because CSP blocks the package CDN font fallback.
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

export const EXCALIDRAW_FONTS_SOURCE = path.resolve(
  process.cwd(),
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
);

export const EXCALIDRAW_FONTS_PUBLIC_DEST = path.resolve(
  process.cwd(),
  "public/fonts",
);

export function copyExcalidrawFonts(options?: {
  source?: string;
  dest?: string;
}): { copied: boolean; source: string; dest: string } {
  const source = options?.source ?? EXCALIDRAW_FONTS_SOURCE;
  const dest = options?.dest ?? EXCALIDRAW_FONTS_PUBLIC_DEST;

  if (!fs.existsSync(source)) {
    return { copied: false, source, dest };
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
  return { copied: true, source, dest };
}

export function copyExcalidrawFontsPlugin(): Plugin {
  const sync = () => {
    const result = copyExcalidrawFonts();
    if (!result.copied) {
      console.warn(
        `[copy-excalidraw-fonts] source missing: ${result.source}. Run npm install.`,
      );
    }
  };

  return {
    name: "copy-excalidraw-fonts",
    buildStart() {
      sync();
    },
    configureServer() {
      sync();
    },
  };
}
