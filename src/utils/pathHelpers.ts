export function getPathSeparator(path: string): "/" | "\\" {
  return path.includes("\\") ? "\\" : "/";
}

export function joinFsPath(basePath: string, ...segments: string[]): string {
  return segments.filter(Boolean).reduce((currentPath, segment) => {
    const separator = getPathSeparator(currentPath);
    return currentPath.endsWith(separator)
      ? `${currentPath}${segment}`
      : `${currentPath}${separator}${segment}`;
  }, basePath);
}

/**
 * Normalize backslashes to forward slashes and strip trailing slashes.
 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Slash-normalize plus Unicode NFC so macOS NFD filenames match
 * NFC markdown/wiki links (e.g. `截图.png`).
 */
export function canonicalizePath(path: string): string {
  return normalizeSlashes(path).normalize("NFC");
}

/**
 * Sanitize a resource folder name: trim, normalize slashes, strip
 * leading/trailing slashes and leading `./`. Rejects `..` path segments.
 */
export function sanitizeResourceFolder(folder: string): string {
  const cleaned = folder
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^\.\//, "");

  if (cleaned.split("/").some((s) => s === "..")) {
    throw new Error("Path traversal is not allowed in resource folder name");
  }

  return cleaned;
}

export function getPathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

/**
 * Compute the relative path from `fromFile` to `toFile`.
 * Uses `fromFile`'s parent directory as the base.
 * Both paths should be forward-slash normalized absolute paths.
 */
export function getRelativePath(fromFile: string, toFile: string): string {
  const fromParts = normalizeSlashes(fromFile).split("/").filter(Boolean);
  const toParts = normalizeSlashes(toFile).split("/").filter(Boolean);

  // Drop filename from source to get its directory
  fromParts.pop();

  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  const upSegments = fromParts.length - commonLength;
  const downSegments = toParts.slice(commonLength);

  if (upSegments === 0 && downSegments.length === 0) return ".";

  const parts = [...Array<string>(upSegments).fill(".."), ...downSegments];

  return parts.join("/");
}

/**
 * Get the parent directory of a path (forward-slash normalized).
 */
export function getPathDirname(path: string): string {
  const normalized = normalizeSlashes(path);
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "/";
  return normalized.slice(0, idx);
}

/**
 * Decode percent-encoded path segments for user-facing text (toasts, labels).
 * Markdown often stores Chinese filenames as `%E5%85%B7…`; leave already-decoded
 * Unicode and remote URLs untouched.
 */
export function decodeUserFacingPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z\d+\-.]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}
