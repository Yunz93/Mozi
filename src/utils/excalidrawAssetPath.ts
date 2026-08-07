/**
 * Point Excalidraw's lazy font loader at the local origin.
 *
 * CSP `font-src 'self'` blocks the default esm.sh CDN fallback, so fonts must
 * be served from `/fonts/**` (copied from @excalidraw/excalidraw by the Vite
 * plugin). This must run before `@excalidraw/excalidraw` is imported.
 */

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

export const EXCALIDRAW_LOCAL_ASSET_PATH = "/";

export function ensureExcalidrawAssetPath(
  target: Pick<Window, "EXCALIDRAW_ASSET_PATH"> | undefined = typeof window ===
  "undefined"
    ? undefined
    : window,
  path: string = EXCALIDRAW_LOCAL_ASSET_PATH,
): string | null {
  if (!target) return null;
  if (
    target.EXCALIDRAW_ASSET_PATH == null ||
    target.EXCALIDRAW_ASSET_PATH === ""
  ) {
    target.EXCALIDRAW_ASSET_PATH = path;
  }
  return Array.isArray(target.EXCALIDRAW_ASSET_PATH)
    ? (target.EXCALIDRAW_ASSET_PATH[0] ?? path)
    : target.EXCALIDRAW_ASSET_PATH;
}
