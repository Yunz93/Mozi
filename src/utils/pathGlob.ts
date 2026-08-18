/**
 * Minimal glob matcher for vault-relative exclude patterns.
 * Supports `*` (one path segment) and `**` (any depth). Matching is
 * case-insensitive and NFC-normalized.
 */

function normalizeMatchPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .normalize("NFC")
    .toLowerCase();
}

export function globToRegExp(glob: string): RegExp | null {
  const trimmed = glob.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.split("/").some((part) => part === "..")) return null;

  const normalized = normalizeMatchPath(trimmed);
  let source = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "*") {
      const next = normalized[i + 1];
      if (next === "*") {
        source += ".*";
        i += 1;
        if (normalized[i + 1] === "/") i += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(ch)) {
      source += `\\${ch}`;
    } else {
      source += ch;
    }
  }

  try {
    return new RegExp(`(?:^|/)${source}(?:$|/)`, "i");
  } catch {
    return null;
  }
}

export function pathMatchesGlob(
  filePath: string,
  glob: string,
  vaultRoot?: string | null,
): boolean {
  const matcher = globToRegExp(glob);
  if (!matcher) return false;

  const normalizedFile = normalizeMatchPath(filePath);
  const normalizedRoot = vaultRoot
    ? normalizeMatchPath(vaultRoot).replace(/\/+$/, "")
    : "";
  const relative =
    normalizedRoot && normalizedFile.startsWith(`${normalizedRoot}/`)
      ? normalizedFile.slice(normalizedRoot.length + 1)
      : normalizedFile;
  return matcher.test(relative) || matcher.test(normalizedFile);
}

export function pathMatchesAnyGlob(
  filePath: string,
  globs: string[] | undefined,
  vaultRoot?: string | null,
): boolean {
  if (!globs?.length) return false;
  return globs.some((glob) => pathMatchesGlob(filePath, glob, vaultRoot));
}

export function parseExcludeGlobText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export const DEFAULT_INDEX_EXCLUDE_GLOBS = [
  ".trash/**",
  "**/node_modules/**",
] as const;
