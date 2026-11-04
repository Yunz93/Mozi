const BEFORE_BLANK = "preview-before-source-blank-line";
const BEFORE_LIST = "preview-before-list";

/** 把相邻块关系标记一次，避免 WebKit 在滚动和重排时反复计算兄弟 :has()。 */
export function applyPreviewBlockSpacing(container: ParentNode): void {
  for (const element of container.querySelectorAll<HTMLElement>(
    `.${BEFORE_BLANK}, .${BEFORE_LIST}`,
  )) {
    const next = element.nextElementSibling;
    element.classList.toggle(
      BEFORE_BLANK,
      next?.classList.contains("preview-source-blank-line") === true,
    );
    element.classList.toggle(
      BEFORE_LIST,
      element.tagName === "P" &&
        (next?.tagName === "UL" || next?.tagName === "OL"),
    );
  }
  for (const next of container.querySelectorAll<HTMLElement>(
    ".preview-source-blank-line, ul, ol",
  )) {
    const previous = next.previousElementSibling;
    if (!previous) continue;
    const className = next.classList.contains("preview-source-blank-line")
      ? BEFORE_BLANK
      : previous.tagName === "P"
        ? BEFORE_LIST
        : null;
    if (className && !previous.classList.contains(className))
      previous.classList.add(className);
  }
}
