// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, type Rule } from "postcss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("reading callout colors in dark mode", () => {
  let host: HTMLDivElement;
  const styles = parse(
    readFileSync(resolve(process.cwd(), "src/styles/preview.css"), "utf8"),
  );
  const allRules: Rule[] = [];
  styles.walkRules((rule) => {
    allRules.push(rule);
  });

  beforeEach(() => {
    host = document.createElement("div");
    host.className = "dark";
    host.innerHTML = `<div class="preview-pane-document markdown-body">
      <blockquote data-plain>普通引用</blockquote>
    </div>`;
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
  });

  function hasDeclaration(rule: Rule, properties: string[]) {
    return rule.nodes.some(
      (node) => node.type === "decl" && properties.includes(node.prop),
    );
  }

  function darkQuotePaintRules() {
    const plain = host.querySelector("[data-plain]")!;
    return allRules.filter(
      (rule) =>
        rule.selector.includes(".dark") &&
        plain.matches(rule.selector) &&
        hasDeclaration(rule, [
          "background",
          "border-left-color",
          "border-inline-start-color",
        ]),
    );
  }

  it("continues to apply the dark quote palette to ordinary quotes", () => {
    const rules = darkQuotePaintRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => hasDeclaration(rule, ["background"]))).toBe(
      true,
    );
    expect(
      rules.some((rule) => hasDeclaration(rule, ["border-left-color"])),
    ).toBe(true);
  });

  it.each([
    "tip",
    "success",
    "warning",
    "caution",
    "error",
    "danger",
    "bug",
    "quote",
    "comment",
  ])(
    "does not paint %s callouts with the ordinary dark quote palette",
    (type) => {
      const callout = document.createElement("blockquote");
      callout.className = `mp-callout mp-callout-${type}`;
      host.querySelector(".preview-pane-document")!.append(callout);

      // 直接验证真实样式选择器，避免 DOM 模拟器不支持 color-mix 造成误判。
      const rules = darkQuotePaintRules();
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(callout.matches(rule.selector), rule.selector).toBe(false);
      }

      const accents = allRules.filter(
        (rule) =>
          callout.matches(rule.selector) &&
          hasDeclaration(rule, ["border-inline-start-color"]),
      );
      expect(accents.length).toBeGreaterThan(0);
    },
  );
});
