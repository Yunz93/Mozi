import { getFileSystem, isTauriEnvironment } from "../types/filesystem";
import { normalizeRemoteImageUrl } from "./remoteImageUrl";

const resolvedPreviewImageCache = new Map<string, string>();
const previewImageLoadCache = new Map<string, Promise<string>>();
const blobUrlCache = new Map<string, Promise<string>>();
const createdBlobUrls = new Set<string>();

let unloadCleanupRegistered = false;

function getCacheKey(src: string, sourceFilePath?: string): string {
  return `${sourceFilePath ?? ""}::${src}`;
}

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z\d+\-.]*:/i.test(value);
}

/**
 * Decode percent-encoded local paths (`foo%20bar.png`) before filesystem lookup.
 * Leaves remote URLs alone so `%20` in query strings stays intact.
 */
function decodeLocalPreviewPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (hasUrlScheme(trimmed) && !trimmed.startsWith("file:")) {
    return trimmed;
  }
  if (trimmed.startsWith("file://")) {
    return decodeFileUrlPath(trimmed);
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function isAbsoluteFilePath(value: string): boolean {
  return /^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(value);
}

function isBrowserVirtualPath(value: string): boolean {
  return (
    /^browser(?:-dir)?-\d+(?:\/|$)/.test(value) || /^browser-\d+-/.test(value)
  );
}

function decodeFileUrlPath(fileUrl: string): string {
  try {
    const url = new URL(fileUrl);
    const decodedPath = decodeURIComponent(url.pathname);
    return /^\/[a-zA-Z]:\//.test(decodedPath)
      ? decodedPath.slice(1)
      : decodedPath;
  } catch {
    return fileUrl.replace(/^file:\/\//i, "");
  }
}

function splitPathRoot(path: string): { root: string; segments: string[] } {
  const normalized = path.replace(/\\/g, "/");

  if (isBrowserVirtualPath(normalized)) {
    const [root, ...rest] = normalized.split("/");
    return { root, segments: rest };
  }

  const windowsMatch = normalized.match(/^([a-zA-Z]:)(?:\/(.*))?$/);
  if (windowsMatch) {
    return {
      root: windowsMatch[1],
      segments: (windowsMatch[2] ?? "").split("/").filter(Boolean),
    };
  }

  if (normalized.startsWith("/")) {
    return {
      root: "/",
      segments: normalized.slice(1).split("/").filter(Boolean),
    };
  }

  return {
    root: "",
    segments: normalized.split("/").filter(Boolean),
  };
}

function joinNormalizedPath(root: string, segments: string[]): string {
  if (root === "/") {
    return `/${segments.join("/")}`;
  }

  if (!root) {
    return segments.join("/");
  }

  return segments.length > 0 ? `${root}/${segments.join("/")}` : root;
}

function resolveRelativeLocalPath(
  sourceFilePath: string,
  targetPath: string,
): string {
  const source = splitPathRoot(sourceFilePath);
  const target = targetPath.replace(/\\/g, "/");
  const isAbsoluteTarget =
    target.startsWith("/") ||
    /^[a-zA-Z]:\//.test(target) ||
    isBrowserVirtualPath(target);
  const baseSegments = isAbsoluteTarget ? [] : source.segments.slice(0, -1);
  const { root: targetRoot, segments: targetSegments } = splitPathRoot(target);
  const root = targetRoot || source.root;
  const segments = isAbsoluteTarget ? [] : baseSegments;

  for (const segment of targetSegments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop();
      }
      continue;
    }
    segments.push(segment);
  }

  return joinNormalizedPath(root, segments);
}

const OBJECT_URL_RETRY_DELAYS_MS = [0, 40, 120];

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function tryGetFileSystem(): Promise<Awaited<
  ReturnType<typeof getFileSystem>
> | null> {
  try {
    return await getFileSystem();
  } catch {
    // Unit tests and browsers without File System Access still render previews
    // via `URL()` / last-resort protocol conversion.
    return null;
  }
}

async function readLocalPreviewObjectUrl(
  getFileObjectUrl: (path: string) => Promise<string>,
  path: string,
): Promise<string> {
  let lastError: unknown;
  for (const delayMs of OBJECT_URL_RETRY_DELAYS_MS) {
    await wait(delayMs);
    try {
      const objectUrl = await getFileObjectUrl(path);
      if (objectUrl) return objectUrl;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to read local preview image: ${path}`);
}

/**
 * Vault files cannot be served over Tauri's `asset://` protocol (no
 * protocol-asset scope). Only in-memory and http(s) URLs can paint in the webview.
 */
export function isUsablePreviewDisplaySrc(src: string): boolean {
  const trimmed = src.trim();
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  );
}

function previewImageNeedsWarm(image: HTMLImageElement): boolean {
  const warmed = image.getAttribute("data-preview-warmed");
  const src = image.getAttribute("src")?.trim() ?? "";
  const originalSrc =
    image.getAttribute("data-original-src")?.trim() ||
    image.getAttribute("data-preview-pending-src")?.trim() ||
    "";
  if (image.getAttribute("data-preview-pending-src")) return true;
  if (warmed === "pending") return true;
  if (originalSrc && (!src || !isUsablePreviewDisplaySrc(src))) return true;
  return false;
}

function registerUnloadCleanup() {
  if (unloadCleanupRegistered || typeof window === "undefined") {
    return;
  }

  window.addEventListener(
    "beforeunload",
    () => {
      createdBlobUrls.forEach((url) => URL.revokeObjectURL(url));
      createdBlobUrls.clear();
    },
    { once: true },
  );

  unloadCleanupRegistered = true;
}

/**
 * Resolve a URL suitable for `<img src>` / media elements.
 *
 * Prefer filesystem object URLs for local files. Tauri's `convertFileSrc`
 * emits `asset://` URLs, but this app does not enable `protocol-asset` for
 * opened vaults — only `fs_scope` is registered — so asset URLs fail to load
 * (broken-image `?` while the filename/alt still appears). Object URLs from
 * `readBinaryFile` work with the existing scope. Callers that care about
 * memory on long docs should defer via {@link previewSourceNeedsMaterialization}
 * + lazy warming instead of resolving every image up front.
 */
export async function resolvePreviewSource(
  src: string,
  sourceFilePath?: string,
  options?: { refresh?: boolean },
): Promise<string> {
  const trimmedSrc = src.trim();
  if (
    !trimmedSrc ||
    trimmedSrc.startsWith("data:") ||
    trimmedSrc.startsWith("blob:")
  ) {
    return trimmedSrc;
  }

  const decodedLocalSrc = decodeLocalPreviewPath(trimmedSrc);

  const localSourceCandidate = trimmedSrc.startsWith("file://")
    ? decodedLocalSrc
    : isAbsoluteFilePath(decodedLocalSrc) ||
        isBrowserVirtualPath(decodedLocalSrc) ||
        (!hasUrlScheme(trimmedSrc) && sourceFilePath)
      ? sourceFilePath &&
        !hasUrlScheme(trimmedSrc) &&
        !isAbsoluteFilePath(decodedLocalSrc) &&
        !isBrowserVirtualPath(decodedLocalSrc)
        ? resolveRelativeLocalPath(sourceFilePath, decodedLocalSrc)
        : decodedLocalSrc
      : "";

  if (localSourceCandidate) {
    const fs = await tryGetFileSystem();
    if (options?.refresh && typeof fs?.refreshFileObjectUrl === "function") {
      return fs.refreshFileObjectUrl(localSourceCandidate);
    }
    if (fs && typeof fs.getFileObjectUrl === "function") {
      // Newly pasted files can miss the first read; retry instead of falling
      // through to `asset://`, which this app cannot load for vault paths.
      return readLocalPreviewObjectUrl(
        fs.getFileObjectUrl.bind(fs),
        localSourceCandidate,
      );
    }
  }

  if (isTauriEnvironment()) {
    if (trimmedSrc.startsWith("asset:") || trimmedSrc.startsWith("tauri:")) {
      return trimmedSrc;
    }

    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const { dirname, join, normalize } = await import("@tauri-apps/api/path");

    let absolutePath = "";
    if (localSourceCandidate && !isBrowserVirtualPath(localSourceCandidate)) {
      absolutePath = localSourceCandidate;
    } else if (trimmedSrc.startsWith("file://")) {
      absolutePath = decodeFileUrlPath(trimmedSrc);
    } else if (isAbsoluteFilePath(decodedLocalSrc)) {
      absolutePath = decodedLocalSrc;
    } else if (sourceFilePath && !hasUrlScheme(trimmedSrc)) {
      absolutePath = await join(await dirname(sourceFilePath), decodedLocalSrc);
    } else {
      return trimmedSrc;
    }

    // Last resort only — object-url helper missing (tests / degraded FS).
    return convertFileSrc(await normalize(absolutePath));
  }

  if (
    !hasUrlScheme(trimmedSrc) &&
    sourceFilePath &&
    typeof window !== "undefined"
  ) {
    try {
      return new URL(decodedLocalSrc, window.location.href).toString();
    } catch {
      return decodedLocalSrc;
    }
  }

  return normalizeRemoteImageUrl(
    trimmedSrc,
    typeof window !== "undefined" ? window.location.protocol : undefined,
  );
}

/**
 * True when displaying the image requires reading file bytes into an object
 * URL. Used to defer materialization until the image approaches the viewport
 * so image-heavy notes do not stutter on first paint.
 */
export function previewSourceNeedsMaterialization(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return false;
  }
  // Remote / protocol URLs that the webview can fetch directly.
  if (
    hasUrlScheme(trimmed) &&
    !trimmed.startsWith("file://") &&
    !trimmed.startsWith("asset:") &&
    !trimmed.startsWith("tauri:")
  ) {
    return false;
  }
  // Local vault files (browser FS Access and Tauri fs_scope) need object URLs.
  // asset:/tauri: are included here because vault asset-protocol serving is
  // not configured; treating them as already-displayable would leave broken imgs.
  return true;
}

async function fetchBlobUrl(src: string): Promise<string> {
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    return src;
  }

  let cached = blobUrlCache.get(src);
  if (cached) {
    return cached;
  }

  cached = (async () => {
    registerUnloadCleanup();

    const response = await fetch(src, {
      cache: "force-cache",
      credentials: "omit",
      mode: /^https?:\/\//i.test(src) ? "cors" : "same-origin",
      referrerPolicy: "no-referrer",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch preview image: ${response.status}`);
    }

    const blobUrl = URL.createObjectURL(await response.blob());
    createdBlobUrls.add(blobUrl);
    return blobUrl;
  })().catch((error) => {
    blobUrlCache.delete(src);
    throw error;
  });

  blobUrlCache.set(src, cached);
  return cached;
}

export function getCachedPreviewImageSrc(
  src: string,
  sourceFilePath?: string,
): string | null {
  return (
    resolvedPreviewImageCache.get(getCacheKey(src, sourceFilePath)) ?? null
  );
}

/** Keep a displayable preview URL so Live Preview remounts can reuse it. */
export function rememberCachedPreviewImageSrc(
  src: string,
  sourceFilePath: string | undefined,
  displaySrc: string,
): void {
  if (!src.trim() || !isUsablePreviewDisplaySrc(displaySrc)) return;
  resolvedPreviewImageCache.set(getCacheKey(src, sourceFilePath), displaySrc);
}

/**
 * Drop a possibly-dead object URL and resolve again.
 * Click-to-reveal destroys the Live Preview `<img>`; some webviews then fail
 * to paint the same `blob:` on the replacement widget.
 */
export async function refreshPreviewSource(
  src: string,
  sourceFilePath?: string,
): Promise<string> {
  const trimmed = src.trim();
  if (!trimmed) return trimmed;
  invalidateCachedPreviewImageSrc(trimmed);
  const next = await resolvePreviewSource(trimmed, sourceFilePath, {
    refresh: true,
  });
  rememberCachedPreviewImageSrc(trimmed, sourceFilePath, next);
  return next;
}

/**
 * Drop cached preview URLs for a vault path (or all entries). Call when the
 * filesystem revokes an object URL so we never reuse a dead `blob:` link.
 */
export function invalidateCachedPreviewImageSrc(path?: string): void {
  if (!path) {
    resolvedPreviewImageCache.clear();
    previewImageLoadCache.clear();
    return;
  }

  const needle = path.replace(/\\/g, "/");
  for (const key of [...resolvedPreviewImageCache.keys()]) {
    const separator = key.indexOf("::");
    const cachedSrc = separator >= 0 ? key.slice(separator + 2) : key;
    const normalizedCached = cachedSrc.replace(/\\/g, "/");
    if (
      normalizedCached === needle ||
      normalizedCached.endsWith(`/${needle}`) ||
      needle.endsWith(`/${normalizedCached}`)
    ) {
      resolvedPreviewImageCache.delete(key);
    }
  }

  for (const key of [...previewImageLoadCache.keys()]) {
    const separator = key.indexOf("::");
    const cachedSrc = separator >= 0 ? key.slice(separator + 2) : key;
    const normalizedCached = cachedSrc.replace(/\\/g, "/");
    if (
      normalizedCached === needle ||
      normalizedCached.endsWith(`/${needle}`) ||
      needle.endsWith(`/${normalizedCached}`)
    ) {
      previewImageLoadCache.delete(key);
    }
  }
}

export function hydrateCachedPreviewImageSources(
  html: string,
  sourceFilePath?: string,
): string {
  if (!html.includes("<img") || typeof DOMParser === "undefined") {
    return html;
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  let hasChanges = false;

  parsed.querySelectorAll("img").forEach((image) => {
    const originalSrc =
      image.getAttribute("data-original-src") || image.getAttribute("src");
    if (!originalSrc) return;

    const cachedSrc = getCachedPreviewImageSrc(originalSrc, sourceFilePath);
    if (
      !cachedSrc ||
      !isUsablePreviewDisplaySrc(cachedSrc) ||
      cachedSrc === image.getAttribute("src")
    ) {
      return;
    }

    image.setAttribute("data-original-src", originalSrc);
    image.setAttribute("src", cachedSrc);
    hasChanges = true;
  });

  return hasChanges ? parsed.body.innerHTML : html;
}

export async function warmPreviewImage(
  src: string,
  sourceFilePath?: string,
): Promise<string> {
  const cacheKey = getCacheKey(src, sourceFilePath);
  const cached = resolvedPreviewImageCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let pending = previewImageLoadCache.get(cacheKey);
  if (pending) {
    return pending;
  }

  pending = (async () => {
    const resolvedSrc = await resolvePreviewSource(src, sourceFilePath);

    if (!resolvedSrc) {
      return src;
    }

    // Already an in-memory object/data URL — cache and return without re-fetching.
    if (resolvedSrc.startsWith("blob:") || resolvedSrc.startsWith("data:")) {
      resolvedPreviewImageCache.set(cacheKey, resolvedSrc);
      return resolvedSrc;
    }

    if (!isUsablePreviewDisplaySrc(resolvedSrc)) {
      throw new Error(`Unusable preview source: ${resolvedSrc}`);
    }

    try {
      const cachedSrc = await fetchBlobUrl(resolvedSrc);
      resolvedPreviewImageCache.set(cacheKey, cachedSrc);
      return cachedSrc;
    } catch {
      resolvedPreviewImageCache.set(cacheKey, resolvedSrc);
      return resolvedSrc;
    }
  })().finally(() => {
    previewImageLoadCache.delete(cacheKey);
  });

  previewImageLoadCache.set(cacheKey, pending);
  return pending;
}

export interface LazyPreviewImageWarmOptions {
  sourceFilePath?: string | null;
  /** IntersectionObserver root (usually the preview scroll container). */
  root?: Element | null;
  rootMargin?: string;
  concurrency?: number;
}

/**
 * Resolve / warm preview images only as they approach the viewport.
 * Used for browser local files that need object-URL materialization, and to
 * optionally upgrade display URLs into the blob cache without blocking first paint.
 */
export function mountLazyPreviewImageWarming(
  container: HTMLElement,
  options: LazyPreviewImageWarmOptions = {},
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    return () => {};
  }

  const sourceFilePath = options.sourceFilePath || undefined;
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const queue: HTMLImageElement[] = [];
  const queued = new WeakSet<HTMLImageElement>();
  let active = 0;
  let cancelled = false;

  const pump = () => {
    while (!cancelled && active < concurrency && queue.length > 0) {
      const image = queue.shift();
      if (!image || !image.isConnected) continue;

      active += 1;
      void (async () => {
        try {
          const originalSrc =
            image.getAttribute("data-original-src")?.trim() ||
            image.getAttribute("data-preview-pending-src")?.trim();
          if (!originalSrc) return;

          const warmedSrc = await warmPreviewImage(originalSrc, sourceFilePath);
          if (cancelled || !image.isConnected) return;

          image.setAttribute("src", warmedSrc);
          image.setAttribute("data-original-src", originalSrc);
          image.setAttribute("data-preview-warmed", "true");
          image.removeAttribute("data-preview-pending-src");
          image.setAttribute("decoding", "async");
          image.setAttribute("loading", "lazy");
          image.setAttribute("fetchpriority", "auto");
        } catch (error) {
          console.warn("Failed to lazily warm preview image:", error);
          if (cancelled || !image.isConnected) return;

          const pendingSrc = image
            .getAttribute("data-preview-pending-src")
            ?.trim();
          if (pendingSrc && !image.getAttribute("src")) {
            try {
              const fallbackSrc = await resolvePreviewSource(
                pendingSrc,
                sourceFilePath,
              );
              if (
                !cancelled &&
                image.isConnected &&
                isUsablePreviewDisplaySrc(fallbackSrc)
              ) {
                image.setAttribute("src", fallbackSrc);
                image.setAttribute("data-preview-warmed", "true");
                image.removeAttribute("data-preview-pending-src");
              }
            } catch {
              // Leave the placeholder; the image stays unloaded.
            }
          }
        } finally {
          active -= 1;
          pump();
        }
      })();
    }
  };

  const enqueue = (image: HTMLImageElement) => {
    if (cancelled || queued.has(image) || !previewImageNeedsWarm(image)) {
      return;
    }
    queued.add(image);
    queue.push(image);
    pump();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target;
        if (!(image instanceof HTMLImageElement)) continue;
        observer.unobserve(image);
        enqueue(image);
      }
    },
    {
      root: options.root ?? null,
      rootMargin: options.rootMargin ?? "320px 0px",
      threshold: 0.01,
    },
  );

  const pendingImages = container.querySelectorAll<HTMLImageElement>(
    'img[data-preview-warmed="pending"], img[data-preview-pending-src], img[data-original-src]',
  );
  // Eagerly enqueue known pending images. IntersectionObserver alone is
  // unreliable with `content-visibility: auto` / rapid preview re-enhance
  // after paste (images stay on empty-src placeholders).
  pendingImages.forEach((image) => {
    observer.observe(image);
    enqueue(image);
  });

  return () => {
    cancelled = true;
    queue.length = 0;
    observer.disconnect();
  };
}
