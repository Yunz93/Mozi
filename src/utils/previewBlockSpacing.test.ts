/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { applyPreviewBlockSpacing } from "./previewBlockSpacing";
describe("preview block spacing relations", () => {
  it("matches the previous sibling-selector semantics for prose, lists, nested callouts and code", () => {
    const root = document.createElement("article");
    root.innerHTML =
      '<p id="plain">text</p><ul><li>item</li></ul><pre id="code">code</pre><div class="preview-source-blank-line"></div><blockquote class="mp-callout"><p id="nested">body</p><div class="preview-source-blank-line"></div></blockquote><p id="last">end</p>';
    applyPreviewBlockSpacing(root);
    expect(
      root.querySelector("#plain")?.classList.contains("preview-before-list"),
    ).toBe(true);
    expect(
      root
        .querySelector("#code")
        ?.classList.contains("preview-before-source-blank-line"),
    ).toBe(true);
    expect(
      root
        .querySelector("#nested")
        ?.classList.contains("preview-before-source-blank-line"),
    ).toBe(true);
    expect(root.querySelector("#last")?.className).toBe("");
  });
  it("does not mutate unchanged classes when an existing preview is reactivated", async () => {
    const root = document.createElement("article");
    root.innerHTML =
      '<p>body</p><div class="preview-source-blank-line"></div><p>next</p><ol><li>item</li></ol>';
    applyPreviewBlockSpacing(root);
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      changes.push(...records),
    );
    observer.observe(root, { subtree: true, attributes: true });
    applyPreviewBlockSpacing(root);
    await Promise.resolve();
    expect(changes).toHaveLength(0);
    observer.disconnect();
  });
  it("updates spacing when the neighboring block changes without replacing the paragraph", () => {
    const root = document.createElement("article");
    root.innerHTML = '<p>body</p><div class="preview-source-blank-line"></div>';
    applyPreviewBlockSpacing(root);
    const paragraph = root.querySelector("p")!;
    root.lastElementChild!.replaceWith(document.createElement("ul"));
    applyPreviewBlockSpacing(root);
    expect(root.querySelector("p")).toBe(paragraph);
    expect(
      paragraph.classList.contains("preview-before-source-blank-line"),
    ).toBe(false);
    expect(paragraph.classList.contains("preview-before-list")).toBe(true);
  });
});
