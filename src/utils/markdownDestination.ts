export interface ParsedMarkdownDestination {
  path: string;
  angleBrackets: boolean;
  title: string;
}

const TRAILING_TITLE_RE = /^(.*?)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*$/;

export function destinationNeedsAngleBrackets(path: string): boolean {
  return /\s/.test(path);
}

export function parseMarkdownDestination(
  rawDestination: string,
): ParsedMarkdownDestination {
  const trimmed = rawDestination.trim();
  if (!trimmed) {
    return { path: "", angleBrackets: false, title: "" };
  }

  if (trimmed.startsWith("<")) {
    const closingIndex = trimmed.indexOf(">");
    if (closingIndex > 0) {
      return {
        path: trimmed.slice(1, closingIndex).trim(),
        angleBrackets: true,
        title: trimmed.slice(closingIndex + 1).trim(),
      };
    }
  }

  const titleMatch = trimmed.match(TRAILING_TITLE_RE);
  if (titleMatch) {
    return {
      path: (titleMatch[1] ?? "").trim(),
      angleBrackets: false,
      title: titleMatch[2]?.trim() ?? "",
    };
  }

  return {
    path: trimmed,
    angleBrackets: false,
    title: "",
  };
}

export function stripMarkdownDestination(
  rawDestination: string,
): string | null {
  const path = parseMarkdownDestination(rawDestination).path.trim();
  return path || null;
}

export function buildMarkdownDestination(
  path: string,
  parsedDestination: ParsedMarkdownDestination,
): string {
  const useBrackets =
    parsedDestination.angleBrackets || destinationNeedsAngleBrackets(path);
  const normalizedPath = useBrackets ? `<${path}>` : path;
  return parsedDestination.title
    ? `${normalizedPath} ${parsedDestination.title}`
    : normalizedPath;
}
