import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  refreshDocumentUpdateTime,
  fillMissingFrontmatterFields,
  parseMetadataTemplateValue,
  normalizeMetadataFields,
  DEFAULT_METADATA_FIELDS,
} from "./metadataFields";

describe("refreshDocumentUpdateTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:34:56.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes timestamp keys in place without rewriting unrelated frontmatter layout", () => {
    const doc = [
      "---",
      "category: notes",
      "",
      "# keep me",
      "date modified: 2020-01-01 00:00:00",
      "slug: my-post",
      "---",
      "",
      "Hello body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);

    expect(next).toContain("category: notes");
    expect(next).toContain("\n\n# keep me\n");
    expect(next).toContain("slug: my-post");
    expect(next.endsWith("\n\nHello body")).toBe(true);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("preserves CRLF line endings inside the frontmatter block when present", () => {
    const doc = "---\r\ndate modified: 2020-01-01\r\n---\r\n\r\nBody";
    const next = refreshDocumentUpdateTime(doc);

    expect(next.startsWith("---\r\n")).toBe(true);
    expect(next).toContain("\r\n---\r\n");
    expect(next.endsWith("\r\n\r\nBody")).toBe(true);
  });

  it("falls back to full round-trip when a refresh key is not on a replaceable single line", () => {
    const doc = [
      "---",
      "update_time: >",
      "  2020-01-01",
      "slug: x",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);

    expect(next).toContain("slug: x");
    expect(next).toMatch(/update_time:/);
    expect(next.endsWith("\n\nBody")).toBe(true);
    expect(next).not.toContain("2020-01-01");
  });

  it("returns content unchanged when there is no frontmatter", () => {
    const doc = "Hello world\n\nNo frontmatter here.";
    expect(refreshDocumentUpdateTime(doc)).toBe(doc);
  });

  it("returns content unchanged when there are no refresh keys", () => {
    const doc = [
      "---",
      "title: My Post",
      "slug: my-post",
      "---",
      "",
      "Body",
    ].join("\n");
    expect(refreshDocumentUpdateTime(doc)).toBe(doc);
  });

  it("handles ISO timestamp with Z suffix", () => {
    const doc = [
      "---",
      "date modified: 2020-01-01T12:00:00Z",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/,
    );
    expect(next).not.toContain("2020-01-01T12:00:00Z");
  });

  it("handles ISO timestamp without Z but with T separator", () => {
    const doc = [
      "---",
      "date modified: 2020-01-01T12:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"/,
    );
    expect(next).not.toContain("2020-01-01T12:00:00");
  });

  it("handles plain date format YYYY-MM-DD", () => {
    const doc = ["---", "date modified: 2020-01-01", "---", "", "Body"].join(
      "\n",
    );

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(next).not.toContain("2020-01-01");
  });

  it("handles quoted YAML keys", () => {
    const doc = [
      "---",
      '"date modified": 2020-01-01 00:00:00',
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /"date modified": "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("handles single-quoted YAML keys", () => {
    const doc = [
      "---",
      "'date modified': 2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /'date modified': "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("preserves comments starting with #", () => {
    const doc = [
      "---",
      "date modified: 2020-01-01 00:00:00",
      "# this is a comment",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toContain("# this is a comment");
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("falls back to legacy when structured YAML value blocks replacement", () => {
    const doc = [
      "---",
      "date modified: |",
      "  2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(/date modified:/);
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("falls back to legacy when a refresh key uses folded block scalar", () => {
    const doc = [
      "---",
      "date modified: >",
      "  2020-01-01",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(/date modified:/);
    expect(next).not.toContain("2020-01-01");
  });

  it("falls back to legacy when refresh key uses flow structure", () => {
    const doc = ["---", "date modified: {a: 1}", "---", "", "Body"].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(/date modified:/);
  });

  it("falls back to legacy when refresh key uses anchor", () => {
    const doc = ["---", "date modified: *anchor", "---", "", "Body"].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(/date modified:/);
  });

  it("falls back to legacy when a refresh key is missing from surgical replacement", () => {
    // 模拟局部替换缺少刷新字段的场景；这个分支很难自然触发，
    // 所以通过 blockedByStructuredValue 路径覆盖旧逻辑回退。
    const docWithBlock = [
      "---",
      "update_time: >",
      "  2020-01-01",
      "date modified: 2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(docWithBlock);
    expect(next).toMatch(/date modified: "\d{4}/);
    expect(next).toMatch(/update_time:/);
  });

  it("returns content unchanged when inner YAML is invalid (non-mapping line after key)", () => {
    const doc = [
      "---",
      "date modified: 2020-01-01 00:00:00",
      "just some text",
      "---",
      "",
      "Body",
    ].join("\n");

    expect(refreshDocumentUpdateTime(doc)).toBe(doc);
  });

  it("returns content unchanged when inner YAML is invalid (leading colon line)", () => {
    const doc = [
      "---",
      ": value",
      "date modified: 2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    expect(refreshDocumentUpdateTime(doc)).toBe(doc);
  });

  it("handles ISO with milliseconds and Z", () => {
    const doc = [
      "---",
      "date modified: 2020-01-01T12:00:00.123Z",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/,
    );
  });

  it("handles space-separated datetime without seconds", () => {
    const doc = [
      "---",
      "date modified: 2020-01-01 12:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
  });

  it("handles unrecognizable timestamp value by using fallback format", () => {
    const doc = [
      "---",
      "date modified: not-a-timestamp",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
  });

  it("handles empty string timestamp value", () => {
    const doc = ["---", "date modified:", "---", "", "Body"].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
  });

  it("handles T-separated datetime without seconds", () => {
    const doc = [
      "---",
      "date modified: 2020-01-01T12:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"/,
    );
  });

  it("does not modify timestamp when it is already current (touchedLowerKeys path)", () => {
    // Use a date that will match the current fake timer date
    const currentDate = new Date("2026-05-11T12:34:56.000Z");
    const localDateTime = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")} ${String(currentDate.getHours()).padStart(2, "0")}:${String(currentDate.getMinutes()).padStart(2, "0")}:${String(currentDate.getSeconds()).padStart(2, "0")}`;

    const doc = [
      "---",
      `date modified: ${localDateTime}`,
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toContain(`date modified: ${localDateTime}`);
  });

  it("handles update_time key", () => {
    const doc = [
      "---",
      "update_time: 2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(/update_time: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/);
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("handles updated_at key", () => {
    const doc = [
      "---",
      "updated_at: 2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(/updated_at: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/);
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("handles date_modified key", () => {
    const doc = [
      "---",
      "date_modified: 2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /date_modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("handles last_modified key", () => {
    const doc = [
      "---",
      "last_modified: 2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /last_modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("handles last modified key with space", () => {
    const doc = [
      "---",
      "last modified: 2020-01-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toMatch(
      /last modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(next).not.toContain("2020-01-01 00:00:00");
  });

  it("handles multiple refresh keys at once", () => {
    const doc = [
      "---",
      "date created: 2020-01-01 00:00:00",
      "date modified: 2020-06-01 00:00:00",
      "---",
      "",
      "Body",
    ].join("\n");

    const next = refreshDocumentUpdateTime(doc);
    expect(next).toContain("date created: 2020-01-01 00:00:00");
    expect(next).not.toContain("2020-06-01 00:00:00");
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
  });
});

describe("parseMetadataTemplateValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:34:56.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns local date for {now}", () => {
    const result = parseMetadataTemplateValue("{now}");
    expect(result).toBe("2026-05-11");
  });

  it("returns local datetime for {now:datetime}", () => {
    const result = parseMetadataTemplateValue("{now:datetime}");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("returns ISO string for {now:iso}", () => {
    const result = parseMetadataTemplateValue("{now:iso}");
    expect(result).toBe("2026-05-11T12:34:56.000Z");
  });

  it("returns empty array for []", () => {
    const result = parseMetadataTemplateValue("[]");
    expect(result).toEqual([]);
  });

  it("returns empty string for {}", () => {
    const result = parseMetadataTemplateValue("{}");
    expect(result).toBe("");
  });

  it("returns true for true", () => {
    expect(parseMetadataTemplateValue("true")).toBe(true);
    expect(parseMetadataTemplateValue("TRUE")).toBe(true);
    expect(parseMetadataTemplateValue("True")).toBe(true);
  });

  it("returns false for false", () => {
    expect(parseMetadataTemplateValue("false")).toBe(false);
    expect(parseMetadataTemplateValue("FALSE")).toBe(false);
    expect(parseMetadataTemplateValue("False")).toBe(false);
  });

  it("returns number for numeric string", () => {
    expect(parseMetadataTemplateValue("42")).toBe(42);
    expect(parseMetadataTemplateValue("3.14")).toBe(3.14);
    expect(parseMetadataTemplateValue("-10")).toBe(-10);
    expect(parseMetadataTemplateValue("0")).toBe(0);
  });

  it("returns original string for non-numeric value", () => {
    expect(parseMetadataTemplateValue("hello")).toBe("hello");
    expect(parseMetadataTemplateValue("draft")).toBe("draft");
  });

  it("returns original string for empty string", () => {
    expect(parseMetadataTemplateValue("")).toBe("");
  });

  it("trims whitespace before parsing", () => {
    expect(parseMetadataTemplateValue("  true  ")).toBe(true);
    expect(parseMetadataTemplateValue("  42  ")).toBe(42);
    expect(parseMetadataTemplateValue("  hello  ")).toBe("  hello  ");
  });

  it("returns original string for whitespace-only string (not numeric)", () => {
    expect(parseMetadataTemplateValue("   ")).toBe("   ");
  });

  it("returns original string for string that is not a special value", () => {
    expect(parseMetadataTemplateValue("some random value")).toBe(
      "some random value",
    );
  });
});

describe("normalizeMetadataFields", () => {
  it("returns default fields when input is not an array", () => {
    expect(normalizeMetadataFields(null)).toEqual(DEFAULT_METADATA_FIELDS);
    expect(normalizeMetadataFields(undefined)).toEqual(DEFAULT_METADATA_FIELDS);
    expect(normalizeMetadataFields("string")).toEqual(DEFAULT_METADATA_FIELDS);
    expect(normalizeMetadataFields(42)).toEqual(DEFAULT_METADATA_FIELDS);
    expect(normalizeMetadataFields({})).toEqual(DEFAULT_METADATA_FIELDS);
  });

  it("returns empty array when input is empty array", () => {
    expect(normalizeMetadataFields([])).toEqual([]);
  });

  it("filters out null and non-object fields", () => {
    const input = [
      null,
      undefined,
      "string",
      42,
      { key: "valid", defaultValue: "value" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "valid", defaultValue: "value", description: "" },
    ]);
  });

  it("filters out fields with empty keys", () => {
    const input = [
      { key: "", defaultValue: "value" },
      { key: "   ", defaultValue: "value" },
      { key: "valid", defaultValue: "value" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "valid", defaultValue: "value", description: "" },
    ]);
  });

  it("trims keys", () => {
    const input = [{ key: "  title  ", defaultValue: "draft" }];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "title", defaultValue: "draft", description: "" },
    ]);
  });

  it("converts non-string defaultValue to string", () => {
    const input = [
      { key: "count", defaultValue: 42 },
      { key: "flag", defaultValue: true },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "count", defaultValue: "42", description: "" },
      { key: "flag", defaultValue: "true", description: "" },
    ]);
  });

  it("handles undefined defaultValue", () => {
    const input = [{ key: "title" }];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "title", defaultValue: "", description: "" },
    ]);
  });

  it("fills default descriptions for known keys when description is missing", () => {
    const input = [
      { key: "category", defaultValue: "notes" },
      { key: "custom", defaultValue: "x", description: "我的说明" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "category", defaultValue: "notes", description: "笔记分类" },
      { key: "custom", defaultValue: "x", description: "我的说明" },
    ]);
  });

  it("preserves an explicitly empty description", () => {
    const input = [{ key: "category", defaultValue: "notes", description: "" }];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "category", defaultValue: "notes", description: "" },
    ]);
  });

  it("upgrades legacy default metadata fields to current defaults", () => {
    const input = [
      { key: "category", defaultValue: "" },
      { key: "tags", defaultValue: "[]" },
      { key: "status", defaultValue: "draft" },
      { key: "is_publish", defaultValue: "false" },
      { key: "date created", defaultValue: "{now}" },
      { key: "date modified", defaultValue: "{now}" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual(DEFAULT_METADATA_FIELDS);
  });

  it("upgrades legacy default metadata fields with seconds to current defaults", () => {
    const input = [
      { key: "category", defaultValue: "" },
      { key: "tags", defaultValue: "[]" },
      { key: "status", defaultValue: "draft" },
      { key: "is_publish", defaultValue: "false" },
      { key: "date created", defaultValue: "{now:datetime}" },
      { key: "date modified", defaultValue: "{now:datetime}" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual(DEFAULT_METADATA_FIELDS);
  });

  it("upgrades renamed legacy default metadata fields to current defaults", () => {
    const input = [
      { key: "category", defaultValue: "" },
      { key: "tags", defaultValue: "[]" },
      { key: "status", defaultValue: "draft" },
      { key: "is_publish", defaultValue: "false" },
      { key: "create_time", defaultValue: "{now}" },
      { key: "update_time", defaultValue: "{now}" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual(DEFAULT_METADATA_FIELDS);
  });

  it("upgrades renamed legacy default metadata fields with seconds to current defaults", () => {
    const input = [
      { key: "category", defaultValue: "" },
      { key: "tags", defaultValue: "[]" },
      { key: "status", defaultValue: "draft" },
      { key: "is_publish", defaultValue: "false" },
      { key: "create_time", defaultValue: "{now:datetime}" },
      { key: "update_time", defaultValue: "{now:datetime}" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual(DEFAULT_METADATA_FIELDS);
  });

  it("renames create_time to date created", () => {
    const input = [{ key: "create_time", defaultValue: "{now}" }];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      {
        key: "date created",
        defaultValue: "{now:datetime}",
        description: "创建时间",
      },
    ]);
  });

  it("renames update_time to date modified", () => {
    const input = [{ key: "update_time", defaultValue: "{now}" }];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      {
        key: "date modified",
        defaultValue: "{now:datetime}",
        description: "最近修改时间",
      },
    ]);
  });

  it("upgrades {now} to {now:datetime} for time-related keys", () => {
    const input = [
      { key: "date created", defaultValue: "{now}" },
      { key: "date modified", defaultValue: "{now}" },
      { key: "create_time", defaultValue: "{now}" },
      { key: "update_time", defaultValue: "{now}" },
      { key: "created_at", defaultValue: "{now}" },
      { key: "updated_at", defaultValue: "{now}" },
      { key: "date_created", defaultValue: "{now}" },
      { key: "date_modified", defaultValue: "{now}" },
      { key: "last_modified", defaultValue: "{now}" },
      { key: "last modified", defaultValue: "{now}" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result.every((f) => f.defaultValue === "{now:datetime}")).toBe(true);
  });

  it("does not upgrade {now} for non-time-related keys", () => {
    const input = [
      { key: "title", defaultValue: "{now}" },
      { key: "category", defaultValue: "{now}" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "title", defaultValue: "{now}", description: "" },
      { key: "category", defaultValue: "{now}", description: "笔记分类" },
    ]);
  });

  it("deduplicates fields by key keeping first occurrence", () => {
    const input = [
      { key: "title", defaultValue: "first" },
      { key: "title", defaultValue: "second" },
      { key: "category", defaultValue: "notes" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "title", defaultValue: "first", description: "" },
      { key: "category", defaultValue: "notes", description: "笔记分类" },
    ]);
  });

  it("returns default fields when all fields are filtered out", () => {
    const input = [{ key: "", defaultValue: "value" }, null, undefined];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual(DEFAULT_METADATA_FIELDS);
  });

  it("preserves non-legacy custom fields", () => {
    const input = [
      { key: "custom_key", defaultValue: "custom_value" },
      { key: "another", defaultValue: "[]" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "custom_key", defaultValue: "custom_value", description: "" },
      { key: "another", defaultValue: "[]", description: "" },
    ]);
  });

  it("handles mixed valid and invalid fields", () => {
    const input = [
      { key: "title", defaultValue: "draft" },
      null,
      { key: "", defaultValue: "empty" },
      { key: "category", defaultValue: "notes" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "title", defaultValue: "draft", description: "" },
      { key: "category", defaultValue: "notes", description: "笔记分类" },
    ]);
  });

  it("does not modify non-legacy fields that happen to share some keys", () => {
    const input = [
      { key: "category", defaultValue: "" },
      { key: "tags", defaultValue: "[]" },
      { key: "status", defaultValue: "draft" },
      { key: "is_publish", defaultValue: "false" },
      // Missing date fields, so not a complete legacy match
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "category", defaultValue: "", description: "笔记分类" },
      { key: "tags", defaultValue: "[]", description: "标签列表" },
      {
        key: "status",
        defaultValue: "draft",
        description: "编辑状态（如 draft / review）",
      },
      { key: "is_publish", defaultValue: "false", description: "是否已发布" },
    ]);
  });

  it("handles fields with extra whitespace in defaultValue", () => {
    const input = [{ key: "date created", defaultValue: "  {now}  " }];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      {
        key: "date created",
        defaultValue: "{now:datetime}",
        description: "创建时间",
      },
    ]);
  });

  it("returns defaults for empty object field", () => {
    const input = [{}];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual(DEFAULT_METADATA_FIELDS);
  });

  it("returns defaults when renameLegacyMetadataKey returns empty", () => {
    // Field with key that maps to empty after legacy rename
    const input = [
      { key: "title", defaultValue: "draft" },
      { key: "", defaultValue: "empty" },
    ];
    const result = normalizeMetadataFields(input);
    expect(result).toEqual([
      { key: "title", defaultValue: "draft", description: "" },
    ]);
  });
});

describe("fillMissingFrontmatterFields", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:34:56.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const fields = [
    { key: "status", defaultValue: "draft", description: "" },
    { key: "slug", defaultValue: "from-template", description: "" },
    { key: "date modified", defaultValue: "{now:datetime}", description: "" },
  ];

  it("appends missing keys without rewriting existing frontmatter layout", () => {
    const doc = [
      "---",
      "status: published",
      "",
      "# keep me",
      "---",
      "",
      "Hello body",
    ].join("\n");

    const next = fillMissingFrontmatterFields(doc, fields);

    expect(next).toContain("status: published");
    expect(next).toContain("\n\n# keep me\n");
    expect(next).toContain("slug: from-template");
    expect(next).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(next.endsWith("\n\nHello body")).toBe(true);
  });

  it("does not overwrite existing keys, including empty values", () => {
    const doc = ["---", "status: published", "slug:", "---", "", "Body"].join(
      "\n",
    );

    const next = fillMissingFrontmatterFields(doc, fields);

    expect(next).toContain("status: published");
    expect(next).toMatch(/^slug:\s*$/m);
    expect(next).not.toContain("slug: from-template");
    expect(next).toContain("date modified:");
  });

  it("matches existing keys case-insensitively and skips duplicate template keys", () => {
    const doc = ["---", "Status: published", "---", "", "Body"].join("\n");
    const next = fillMissingFrontmatterFields(doc, [
      { key: "status", defaultValue: "draft", description: "" },
      { key: "Status", defaultValue: "other", description: "" },
      { key: "slug", defaultValue: "hello", description: "" },
    ]);

    expect(next).toContain("Status: published");
    expect(next).not.toContain("status: draft");
    expect(next).not.toContain("Status: other");
    expect(next).toContain("slug: hello");
  });

  it("prepends a frontmatter block when the document has none", () => {
    const doc = "Hello world\n";
    const next = fillMissingFrontmatterFields(doc, [
      { key: "status", defaultValue: "draft", description: "" },
    ]);

    expect(next.startsWith("---\n")).toBe(true);
    expect(next).toContain("status: draft");
    expect(next.endsWith("Hello world\n")).toBe(true);
  });

  it("leaves invalid frontmatter unchanged", () => {
    const doc = ["---", "status: [", "---", "", "Body"].join("\n");
    expect(fillMissingFrontmatterFields(doc, fields)).toBe(doc);
  });

  it("skips empty template keys and no-ops on an empty template", () => {
    const doc = ["---", "title: keep", "---", "", "Body"].join("\n");
    expect(fillMissingFrontmatterFields(doc, [])).toBe(doc);
    expect(
      fillMissingFrontmatterFields(doc, [
        { key: "   ", defaultValue: "nope", description: "" },
      ]),
    ).toBe(doc);
  });

  it("preserves CRLF line endings when appending missing keys", () => {
    const doc = "---\r\nstatus: published\r\n---\r\n\r\nBody";
    const next = fillMissingFrontmatterFields(doc, [
      { key: "slug", defaultValue: "hello", description: "" },
    ]);

    expect(next.startsWith("---\r\n")).toBe(true);
    expect(next).toContain("\r\nslug: hello\r\n");
    expect(next.endsWith("\r\n\r\nBody")).toBe(true);
  });
});
