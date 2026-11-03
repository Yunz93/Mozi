/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "src/styles/preview.css"),
  "utf8",
);
let stylesheet: HTMLStyleElement | null = null;

function renderQuote(theme: "light" | "dark", className = "") {
  stylesheet = document.createElement("style");
  stylesheet.textContent = css;
  document.head.appendChild(stylesheet);
  document.body.innerHTML = `<div class="${theme}"><article class="preview-pane-document markdown-body"><blockquote class="${className}"><p>书评</p></blockquote></article></div>`;
  return document.querySelector("blockquote")!;
}

afterEach(() => {
  stylesheet?.remove();
  document.body.innerHTML = "";
});

describe("preview quote surfaces", () => {
  it.each(["light", "dark"] as const)(
    "keeps %s plain reviews unfilled after all theme overrides",
    (theme) => {
      const quote = renderQuote(theme);
      expect(getComputedStyle(quote).backgroundColor).toBe("transparent");
      expect(getComputedStyle(quote).borderLeftWidth).toBe("1px");
    },
  );

  it.each(["light", "dark"] as const)(
    "keeps %s semantic callouts filled while plain reviews are unfilled",
    (theme) => {
      const quote = renderQuote(theme, "mp-callout mp-callout-tip");
      expect(getComputedStyle(quote).backgroundColor).not.toBe("transparent");
      expect(getComputedStyle(quote).borderInlineStartWidth).toBe("4px");
    },
  );
});
