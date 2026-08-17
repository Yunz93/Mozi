import yaml from "js-yaml";
import type { Frontmatter, ParsedMarkdown } from "../types";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Replace the inner YAML region between --- fences without re-serializing the whole block.
 * Returning null from replacer aborts and leaves the original document unchanged.
 */
export function replaceFrontmatterInner(
  content: string,
  replacer: (inner: string, meta: { lineEnding: string }) => string | null,
): string | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match || match.index === undefined) {
    return null;
  }

  const inner = match[1];
  const lineEnding = /\r\n/.test(match[0]) ? "\r\n" : "\n";
  const replacementInner = replacer(inner, { lineEnding });
  if (replacementInner === null) {
    return null;
  }

  const entireBlock = match[0];
  const innerOffset = entireBlock.indexOf(inner);
  if (innerOffset < 0) {
    return null;
  }

  const newBlock = `${entireBlock.slice(0, innerOffset)}${replacementInner}${entireBlock.slice(innerOffset + inner.length)}`;
  return `${content.slice(0, match.index)}${newBlock}${content.slice(match.index + entireBlock.length)}`;
}

function shouldQuoteYamlString(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^\s|\s$/.test(value) ||
    /[\n\r]/.test(value) ||
    /^(true|false|null|~)$/i.test(trimmed) ||
    /^[+-]?\d+(?:\.\d+)?$/.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
      trimmed,
    ) ||
    /^[-?:@`!&*|>%{\[]/.test(trimmed) ||
    /:\s/.test(value) ||
    /^#/.test(trimmed) ||
    /\s#$/.test(value)
  );
}

function formatYamlKey(key: string): string {
  return shouldQuoteYamlString(key) ? JSON.stringify(key) : key;
}

/** String scalars as written after `key:` in YAML — matches generateFrontmatter / updateFrontmatter. */
export function formatYamlStringScalar(value: string): string {
  if (value === "") {
    return "";
  }
  return shouldQuoteYamlString(value) ? JSON.stringify(value) : value;
}

function formatYamlScalar(value: unknown): string {
  if (typeof value === "string") {
    return formatYamlStringScalar(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "";
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value);
}

function renderYamlValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return ["- "];
    }

    return value.flatMap((item) => {
      const rendered = renderYamlValue(item);
      if (rendered.length === 1) {
        return [`- ${rendered[0]}`];
      }

      return [
        `- ${rendered[0]}`,
        ...rendered.slice(1).map((line) => `  ${line}`),
      ];
    });
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return [""];
    }

    return entries.flatMap(([key, nestedValue]) => {
      const rendered = renderYamlValue(nestedValue);
      if (rendered.length === 1) {
        return [`${formatYamlKey(key)}: ${rendered[0]}`];
      }

      return [`${formatYamlKey(key)}:`, ...rendered.map((line) => `  ${line}`)];
    });
  }

  return [formatYamlScalar(value)];
}

function normalizeFrontmatterValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (Array.isArray(value)) {
    // Preserve empty YAML list items while the user is editing frontmatter.
    // Auto-save may round-trip frontmatter to refresh timestamps; filtering
    // null/undefined here would delete a just-created `- ` placeholder line.
    return value.map((item) => normalizeFrontmatterValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, nestedValue]) => [key, normalizeFrontmatterValue(nestedValue)],
      ),
    );
  }

  return value;
}

/**
 * Parse frontmatter from markdown content
 */
export function parseFrontmatter(content: string): ParsedMarkdown {
  if (!content) {
    return { frontmatter: null, body: "" };
  }

  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    return { frontmatter: null, body: content };
  }

  try {
    const parsed = normalizeFrontmatterValue(yaml.load(match[1]));
    const frontmatter = (parsed ?? null) as Frontmatter | null;
    const body = content.substring(match[0].length).trim();
    return { frontmatter, body };
  } catch (error) {
    console.error("Frontmatter parsing error:", error);
    // Return content without frontmatter if parsing fails
    return { frontmatter: null, body: content };
  }
}

/**
 * Generate frontmatter YAML string
 */
export function generateFrontmatter(frontmatter: Frontmatter): string {
  try {
    const entries = Object.entries(frontmatter).filter(
      ([, value]) => value !== undefined,
    );
    if (entries.length === 0) {
      return "";
    }

    const yamlLines = entries.flatMap(([key, value]) => {
      const rendered = renderYamlValue(value);
      if (Array.isArray(value)) {
        return [
          `${formatYamlKey(key)}:`,
          ...rendered.map((line) => `  ${line}`),
        ];
      }

      if (rendered.length === 1) {
        return [`${formatYamlKey(key)}: ${rendered[0]}`];
      }

      return [`${formatYamlKey(key)}:`, ...rendered.map((line) => `  ${line}`)];
    });

    return `---\n${yamlLines.join("\n")}\n---\n\n`;
  } catch (error) {
    console.error("Frontmatter generation error:", error);
    return "";
  }
}

/**
 * Update or add frontmatter in markdown content
 */
export function updateFrontmatter(
  content: string,
  newFrontmatter: Frontmatter,
): string {
  const parsed = parseFrontmatter(content);
  const mergedFrontmatter = { ...parsed.frontmatter, ...newFrontmatter };
  const frontmatterBlock = generateFrontmatter(mergedFrontmatter);

  if (frontmatterBlock) {
    const match = content.match(FRONTMATTER_REGEX);
    const rawBody = match
      ? content.slice(match[0].length).replace(/^\r?\n/, "")
      : content.replace(/^\r?\n/, "");

    return frontmatterBlock + rawBody;
  }

  return content;
}

/**
 * Remove frontmatter from markdown content
 */
export function removeFrontmatter(content: string): string {
  const parsed = parseFrontmatter(content);
  return parsed.body;
}

/**
 * Get frontmatter value by key
 */
export function getFrontmatterValue(
  content: string,
  key: string,
): Frontmatter[keyof Frontmatter] | null {
  const parsed = parseFrontmatter(content);
  return parsed.frontmatter?.[key] ?? null;
}

/**
 * Set frontmatter value by key
 */
export function setFrontmatterValue(
  content: string,
  key: string,
  value: string | string[],
): string {
  const parsed = parseFrontmatter(content);
  const updatedFrontmatter = {
    ...parsed.frontmatter,
    [key]: value,
  };
  return updateFrontmatter(content, updatedFrontmatter);
}
