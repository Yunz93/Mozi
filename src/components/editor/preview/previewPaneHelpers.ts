/**
 * Pure helpers for PreviewPane link handling and frontmatter display.
 * Kept separate from the component so they can be unit-tested without
 * mounting the (large) preview component.
 */

import type { Frontmatter } from "../../../types";

export function isExternalLink(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href.trim());
}

export function isValidExternalUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.protocol === "https:" ||
      url.protocol === "http:" ||
      url.protocol === "mailto:" ||
      url.protocol === "tel:"
    );
  } catch {
    return false;
  }
}

export type FrontmatterValue = Frontmatter[keyof Frontmatter];

export function getFrontmatterDisplayItems(value: FrontmatterValue): string[] {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    return items.length > 0 ? items : [""];
  }

  if (value === null || value === undefined) {
    return [""];
  }

  return [String(value)];
}
