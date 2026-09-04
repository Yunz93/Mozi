import { createHeadingSlug, type HeadingNode } from "./outline";
import { flushPendingPreviewHeadingScroll } from "./previewNavigationBridge";

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
}

function normalizeHeadingText(text: string): string {
  return stripInlineMarkdown(text).trim().replace(/\s+/g, " ");
}

/**
 * Stamp outline heading ids onto preview DOM headings.
 * Prefer text match so an extra/missing HTML heading does not shift every
 * subsequent id (index-only pairing was a common source of missed jumps).
 */
export function applyPreviewHeadingAttributes(
  container: HTMLElement,
  headings: HeadingNode[],
  activeTabId?: string | null,
): void {
  const headingElements = Array.from(
    container.querySelectorAll<HTMLElement>(
      "article.markdown-body h1, article.markdown-body h2, article.markdown-body h3, article.markdown-body h4, article.markdown-body h5, article.markdown-body h6",
    ),
  ).filter((element) => {
    const embed = element.closest(".preview-note-embed-body");
    return !embed || embed === container;
  });

  const assigned = new Set<HeadingNode>();

  const stamp = (element: HTMLElement, heading: HeadingNode) => {
    element.id = heading.id;
    element.dataset.headingId = heading.id;
    element.dataset.headingSlug = createHeadingSlug(heading.text);
    element.dataset.headingText = heading.text;
    assigned.add(heading);
  };

  const clear = (element: HTMLElement) => {
    element.removeAttribute("data-heading-id");
    element.removeAttribute("data-heading-slug");
    element.removeAttribute("data-heading-text");
  };

  // Pass 1: exact normalized text match (stable across DOM drift).
  for (const element of headingElements) {
    const domText = normalizeHeadingText(element.textContent ?? "");
    const match = headings.find(
      (heading) =>
        !assigned.has(heading) &&
        normalizeHeadingText(heading.text) === domText,
    );
    if (match) {
      stamp(element, match);
    }
  }

  // Pass 2: fill remaining elements by outline order among unused headings.
  let unusedIndex = 0;
  const unusedHeadings = headings.filter((heading) => !assigned.has(heading));
  for (const element of headingElements) {
    if (element.dataset.headingId) continue;
    const heading = unusedHeadings[unusedIndex++];
    if (!heading) {
      clear(element);
      continue;
    }
    stamp(element, heading);
  }

  if (activeTabId) {
    flushPendingPreviewHeadingScroll(activeTabId);
  }
}
