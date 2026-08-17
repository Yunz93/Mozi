import type { Frontmatter, MetadataField } from "../types";
import {
  formatYamlStringScalar,
  generateFrontmatter,
  parseFrontmatter,
  replaceFrontmatterInner,
  updateFrontmatter,
} from "./frontmatter";

const LEGACY_DEFAULT_METADATA_FIELDS: MetadataField[] = [
  { key: "category", defaultValue: "", description: "" },
  { key: "tags", defaultValue: "[]", description: "" },
  { key: "status", defaultValue: "draft", description: "" },
  { key: "is_publish", defaultValue: "false", description: "" },
  { key: "date created", defaultValue: "{now}", description: "" },
  { key: "date modified", defaultValue: "{now}", description: "" },
];

const LEGACY_DEFAULT_METADATA_FIELDS_WITH_SECONDS: MetadataField[] = [
  { key: "category", defaultValue: "", description: "" },
  { key: "tags", defaultValue: "[]", description: "" },
  { key: "status", defaultValue: "draft", description: "" },
  { key: "is_publish", defaultValue: "false", description: "" },
  { key: "date created", defaultValue: "{now:datetime}", description: "" },
  { key: "date modified", defaultValue: "{now:datetime}", description: "" },
];

const RENAMED_LEGACY_DEFAULT_METADATA_FIELDS: MetadataField[] = [
  { key: "category", defaultValue: "", description: "" },
  { key: "tags", defaultValue: "[]", description: "" },
  { key: "status", defaultValue: "draft", description: "" },
  { key: "is_publish", defaultValue: "false", description: "" },
  { key: "create_time", defaultValue: "{now}", description: "" },
  { key: "update_time", defaultValue: "{now}", description: "" },
];

const RENAMED_LEGACY_DEFAULT_METADATA_FIELDS_WITH_SECONDS: MetadataField[] = [
  { key: "category", defaultValue: "", description: "" },
  { key: "tags", defaultValue: "[]", description: "" },
  { key: "status", defaultValue: "draft", description: "" },
  { key: "is_publish", defaultValue: "false", description: "" },
  { key: "create_time", defaultValue: "{now:datetime}", description: "" },
  { key: "update_time", defaultValue: "{now:datetime}", description: "" },
];

export const DEFAULT_METADATA_FIELDS: MetadataField[] = [
  { key: "category", defaultValue: "", description: "笔记分类" },
  { key: "tags", defaultValue: "[]", description: "标签列表" },
  {
    key: "status",
    defaultValue: "draft",
    description: "编辑状态（如 draft / review）",
  },
  { key: "slug", defaultValue: "", description: "发布用短链接标识" },
  { key: "aliases", defaultValue: "", description: "别名，便于双链引用" },
  { key: "is_publish", defaultValue: "false", description: "是否已发布" },
  {
    key: "date created",
    defaultValue: "{now:datetime}",
    description: "创建时间",
  },
  {
    key: "date modified",
    defaultValue: "{now:datetime}",
    description: "最近修改时间",
  },
];

const DEFAULT_METADATA_DESCRIPTION_BY_KEY = new Map(
  DEFAULT_METADATA_FIELDS.map((field) => [field.key, field.description]),
);
const AUTO_REFRESH_UPDATE_TIME_KEYS = new Set([
  "update_time",
  "updated_at",
  "date modified",
  "date_modified",
  "last_modified",
  "last modified",
]);

function cloneMetadataFields(fields: MetadataField[]): MetadataField[] {
  return fields.map((field) => ({ ...field }));
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(date: Date, separator: "T" | " " = " "): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${formatLocalDate(date)}${separator}${hours}:${minutes}:${seconds}`;
}

function fieldsMatch(
  fields: MetadataField[],
  expectedFields: readonly MetadataField[],
): boolean {
  return (
    fields.length === expectedFields.length &&
    fields.every(
      (field, index) =>
        field.key === expectedFields[index].key &&
        field.defaultValue === expectedFields[index].defaultValue,
    )
  );
}

function normalizeMetadataDescription(
  key: string,
  rawDescription: unknown,
  hasDescriptionProp: boolean,
): string {
  if (hasDescriptionProp) {
    return typeof rawDescription === "string"
      ? rawDescription
      : String(rawDescription ?? "");
  }

  return DEFAULT_METADATA_DESCRIPTION_BY_KEY.get(key) ?? "";
}

function renameLegacyMetadataKey(key: string): string {
  if (key === "create_time") return "date created";
  if (key === "update_time") return "date modified";
  return key;
}

function shouldUseDateTimePrecision(key: string): boolean {
  const normalizedKey = key.trim().toLowerCase();
  return (
    normalizedKey === "create_time" ||
    normalizedKey === "date created" ||
    normalizedKey === "date_created" ||
    normalizedKey === "created_at" ||
    AUTO_REFRESH_UPDATE_TIME_KEYS.has(normalizedKey)
  );
}

function normalizeMetadataDefaultValue(
  key: string,
  defaultValue: string,
): string {
  const trimmedDefaultValue = defaultValue.trim();
  if (trimmedDefaultValue === "{now}" && shouldUseDateTimePrecision(key)) {
    return "{now:datetime}";
  }

  return defaultValue;
}

function normalizeTimestampValue(value: unknown, key: string): string {
  const now = new Date();
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return shouldUseDateTimePrecision(key)
      ? formatLocalDateTime(now, " ")
      : formatLocalDate(now);
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z$/.test(trimmed)) {
    return now.toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
    return formatLocalDateTime(now, "T");
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
    return formatLocalDateTime(now, " ");
  }

  return shouldUseDateTimePrecision(key)
    ? formatLocalDateTime(now, " ")
    : formatLocalDate(now);
}

export function parseMetadataTemplateValue(
  rawValue: string,
): string | string[] | number | boolean {
  const normalized = rawValue.trim();

  if (normalized === "{now}") return formatLocalDate(new Date());
  if (normalized === "{now:datetime}")
    return formatLocalDateTime(new Date(), " ");
  if (normalized === "{now:iso}") return new Date().toISOString();
  if (normalized === "[]") return [];
  if (normalized === "{}") return "";
  if (normalized.toLowerCase() === "true") return true;
  if (normalized.toLowerCase() === "false") return false;

  const num = Number(rawValue);
  if (!Number.isNaN(num) && rawValue.trim() !== "") return num;

  return rawValue;
}

export function normalizeMetadataFields(input: unknown): MetadataField[] {
  if (!Array.isArray(input)) {
    return cloneMetadataFields(DEFAULT_METADATA_FIELDS);
  }

  // Preserve an intentionally empty template instead of repopulating defaults on restart.
  if (input.length === 0) {
    return [];
  }

  const rawFields = input
    .map((field): MetadataField | null => {
      if (!field || typeof field !== "object") return null;

      const rawKey = "key" in field ? field.key : "";
      const rawDefaultValue = "defaultValue" in field ? field.defaultValue : "";
      const hasDescriptionProp = "description" in field;
      const rawDescription = hasDescriptionProp ? field.description : undefined;
      const key = typeof rawKey === "string" ? rawKey.trim() : "";

      if (!key) return null;

      return {
        key,
        defaultValue: normalizeMetadataDefaultValue(
          key,
          typeof rawDefaultValue === "string"
            ? rawDefaultValue
            : String(rawDefaultValue ?? ""),
        ),
        description: normalizeMetadataDescription(
          key,
          rawDescription,
          hasDescriptionProp,
        ),
      };
    })
    .filter((field): field is MetadataField => Boolean(field));

  if (
    fieldsMatch(rawFields, LEGACY_DEFAULT_METADATA_FIELDS) ||
    fieldsMatch(rawFields, LEGACY_DEFAULT_METADATA_FIELDS_WITH_SECONDS)
  ) {
    return cloneMetadataFields(DEFAULT_METADATA_FIELDS);
  }

  if (
    fieldsMatch(rawFields, RENAMED_LEGACY_DEFAULT_METADATA_FIELDS) ||
    fieldsMatch(rawFields, RENAMED_LEGACY_DEFAULT_METADATA_FIELDS_WITH_SECONDS)
  ) {
    return cloneMetadataFields(DEFAULT_METADATA_FIELDS);
  }

  const fields = rawFields
    .map((field): MetadataField | null => {
      const key = renameLegacyMetadataKey(field.key);

      if (!key) return null;

      return {
        key,
        defaultValue: normalizeMetadataDefaultValue(key, field.defaultValue),
        description:
          field.description ||
          (key !== field.key
            ? (DEFAULT_METADATA_DESCRIPTION_BY_KEY.get(key) ?? "")
            : ""),
      };
    })
    .filter((field): field is MetadataField => Boolean(field));

  if (fields.length === 0) {
    return cloneMetadataFields(DEFAULT_METADATA_FIELDS);
  }

  const dedupedFields: MetadataField[] = [];
  const seenKeys = new Set<string>();
  for (const field of fields) {
    if (seenKeys.has(field.key)) continue;
    seenKeys.add(field.key);
    dedupedFields.push(field);
  }

  return dedupedFields;
}

function stripYamlKeyQuotes(rawKey: string): string {
  const t = rawKey.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Scalar timestamps only — block/flow structures need full YAML round-trip */
function isInlineTimestampYamlValue(rawTail: string): boolean {
  const t = rawTail.trim();
  if (!t) {
    return true;
  }

  if (t === "|" || t === ">") {
    return false;
  }

  if (t.startsWith("|") || t.startsWith(">")) {
    return false;
  }

  if (
    t.startsWith("{") ||
    t.startsWith("[") ||
    t.startsWith("*") ||
    t.startsWith("&")
  ) {
    return false;
  }

  return true;
}

function legacyRefreshDocumentUpdateTime(
  content: string,
  frontmatter: Frontmatter,
): string {
  const updates: Frontmatter = {};
  let hasUpdates = false;

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!AUTO_REFRESH_UPDATE_TIME_KEYS.has(key.trim().toLowerCase())) {
      continue;
    }

    updates[key] = normalizeTimestampValue(value, key);
    hasUpdates = true;
  }

  if (!hasUpdates) {
    return content;
  }

  return updateFrontmatter(content, updates);
}

/**
 * Refresh update-time frontmatter keys without rewriting the entire YAML block.
 * Full round-trips reorder/reformat keys and cause large editor replacements that steal focus/caret.
 */
export function refreshDocumentUpdateTime(content: string): string {
  const { frontmatter } = parseFrontmatter(content);
  if (!frontmatter) {
    return content;
  }

  const refreshKeysLower = new Set(
    Object.keys(frontmatter)
      .filter((key) =>
        AUTO_REFRESH_UPDATE_TIME_KEYS.has(key.trim().toLowerCase()),
      )
      .map((key) => key.trim().toLowerCase()),
  );

  if (refreshKeysLower.size === 0) {
    return content;
  }

  const touchedLowerKeys = new Set<string>();

  const surgical = replaceFrontmatterInner(content, (inner, { lineEnding }) => {
    const lines = inner.split(/\r?\n/);
    let blockedByStructuredValue = false;

    const nextLines = lines.map((line) => {
      const trimmedStart = line.trimStart();
      if (trimmedStart.startsWith("#")) {
        return line;
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx <= 0) {
        return line;
      }

      const keySegment = line.slice(0, colonIdx);
      const logicalKey = stripYamlKeyQuotes(keySegment.trim());

      if (!AUTO_REFRESH_UPDATE_TIME_KEYS.has(logicalKey.toLowerCase())) {
        return line;
      }

      const afterColon = line.slice(colonIdx + 1);
      const rawTail = afterColon.replace(/^\s*/, "");

      if (!isInlineTimestampYamlValue(rawTail)) {
        blockedByStructuredValue = true;
        return line;
      }

      const nextStamp = normalizeTimestampValue(rawTail, logicalKey);
      if (rawTail.trim() === nextStamp) {
        touchedLowerKeys.add(logicalKey.toLowerCase());
        return line;
      }

      touchedLowerKeys.add(logicalKey.toLowerCase());

      const leadingWs = afterColon.match(/^\s*/)?.[0] ?? "";
      const spacing = leadingWs.length > 0 ? leadingWs : " ";
      const formattedStamp = formatYamlStringScalar(nextStamp);
      return `${line.slice(0, colonIdx + 1)}${spacing}${formattedStamp}`;
    });

    if (blockedByStructuredValue) {
      return null;
    }

    for (const keyLower of refreshKeysLower) {
      if (!touchedLowerKeys.has(keyLower)) {
        return null;
      }
    }

    return nextLines.join(lineEnding);
  });

  if (surgical !== null) {
    return surgical;
  }

  return legacyRefreshDocumentUpdateTime(content, frontmatter);
}

function collectMissingFrontmatterFields(
  existing: Frontmatter,
  fields: MetadataField[],
): Frontmatter {
  const existingLower = new Set(
    Object.keys(existing).map((key) => key.trim().toLowerCase()),
  );
  const additions: Frontmatter = {};
  const seenTemplateLower = new Set<string>();

  for (const field of fields) {
    const key = field.key.trim();
    if (!key) continue;

    const keyLower = key.toLowerCase();
    if (seenTemplateLower.has(keyLower)) continue;
    seenTemplateLower.add(keyLower);
    if (existingLower.has(keyLower)) continue;

    additions[key] = parseMetadataTemplateValue(field.defaultValue);
  }

  return additions;
}

/**
 * Add metadata-template keys that are missing from frontmatter.
 * Existing keys are left unchanged (including empty values). Auto-save callers
 * should skip this; parse errors with `---` fences are left untouched.
 */
export function fillMissingFrontmatterFields(
  content: string,
  fields: MetadataField[],
): string {
  if (fields.length === 0) {
    return content;
  }

  const { frontmatter, body } = parseFrontmatter(content);
  const fenceProbe = replaceFrontmatterInner(content, (inner) => inner);
  const hasFrontmatterFences = fenceProbe !== null;

  if (hasFrontmatterFences && frontmatter === null && body === content) {
    return content;
  }

  const additions = collectMissingFrontmatterFields(frontmatter ?? {}, fields);
  if (Object.keys(additions).length === 0) {
    return content;
  }

  if (!hasFrontmatterFences) {
    return `${generateFrontmatter(additions)}${content}`;
  }

  const surgical = replaceFrontmatterInner(content, (inner, { lineEnding }) => {
    const generated = generateFrontmatter(additions);
    const generatedMatch = generated.match(/^---\n([\s\S]*?)\n---\n\n$/);
    if (!generatedMatch) {
      return null;
    }

    const additionInner = generatedMatch[1].split("\n").join(lineEnding);
    if (!additionInner) {
      return null;
    }

    const innerTrimEnd = inner.replace(/(?:\r?\n)+$/, "");
    if (innerTrimEnd.length === 0) {
      return additionInner;
    }

    return `${innerTrimEnd}${lineEnding}${additionInner}`;
  });

  if (surgical !== null) {
    return surgical;
  }

  return updateFrontmatter(content, additions);
}
