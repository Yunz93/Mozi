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
  const matchedElements = new Set<HTMLElement>();

  const stamp = (element: HTMLElement, heading: HeadingNode) => {
    const text = heading.text;
    const slug = createHeadingSlug(text);
    // 保留预览再次激活时，不改写相同属性，避免重复通知观察器并使样式失效。
    if (element.id !== heading.id) element.id = heading.id;
    if (element.dataset.headingId !== heading.id)
      element.dataset.headingId = heading.id;
    if (element.dataset.headingSlug !== slug)
      element.dataset.headingSlug = slug;
    if (element.dataset.headingText !== text)
      element.dataset.headingText = text;
    assigned.add(heading);
    matchedElements.add(element);
  };

  const clear = (element: HTMLElement) => {
    element.removeAttribute("data-heading-id");
    element.removeAttribute("data-heading-slug");
    element.removeAttribute("data-heading-text");
  };

  // 按规范化文字建立队列，重复标题仍按原顺序匹配，避免逐标题从头扫描大纲。
  const headingsByText = new Map<
    string,
    { items: HeadingNode[]; next: number }
  >();
  for (const heading of headings) {
    const text = normalizeHeadingText(heading.text);
    const queue = headingsByText.get(text);
    if (queue) queue.items.push(heading);
    else headingsByText.set(text, { items: [heading], next: 0 });
  }
  for (const element of headingElements) {
    const queue = headingsByText.get(
      normalizeHeadingText(element.textContent ?? ""),
    );
    if (!queue) continue;
    while (
      queue.next < queue.items.length &&
      assigned.has(queue.items[queue.next])
    )
      queue.next++;
    const match = queue.items[queue.next++];
    if (match) stamp(element, match);
  }

  // Pass 2: fill remaining elements by outline order among unused headings.
  let unusedIndex = 0;
  const unusedHeadings = headings.filter((heading) => !assigned.has(heading));
  for (const element of headingElements) {
    if (matchedElements.has(element)) continue;
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
