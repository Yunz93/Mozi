import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getMarkdownStyleTokens } from "./markdownStyle";

const { parseColor } = createRequire(import.meta.url)(
  "html2canvas/dist/lib/css/types/color.js",
) as { parseColor: (context: unknown, color: string) => number };

function rgba(color: string): number[] {
  const value = parseColor({}, color);
  return [
    value >>> 24,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    (value & 255) / 255,
  ];
}

function blend(color: number[], canvas: number[]): number[] {
  return color
    .slice(0, 3)
    .map(
      (channel, index) => channel * color[3] + canvas[index] * (1 - color[3]),
    );
}

function luminance(color: number[]): number {
  return color.slice(0, 3).reduce((sum, channel, index) => {
    const value = channel / 255;
    const linear =
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

describe("default document readability", () => {
  const workspaceCss = readFileSync(
    resolve(process.cwd(), "src/styles/workspace.css"),
    "utf8",
  );

  it.each(["light", "dark"] as const)(
    "keeps %s body, reviews and highlights readable on the actual workspace canvas",
    (theme) => {
      const selector = theme === "dark" ? "\\.dark" : ":root";
      const canvasColor = workspaceCss.match(
        new RegExp(`${selector}\\s*\\{[^}]*--workspace-canvas:\\s*([^;]+)`),
      )?.[1];
      expect(canvasColor).toBeTruthy();
      const canvas = rgba(canvasColor!);
      const tokens = getMarkdownStyleTokens("nord", theme);
      const samples = [
        ["body", rgba(tokens.text), canvas],
        ["review", rgba(tokens.quoteText), canvas],
        [
          "highlight",
          rgba(tokens.markText),
          blend(rgba(tokens.markBg), canvas),
        ],
      ] as const;
      for (const [label, foreground, background] of samples) {
        const values = [luminance(foreground), luminance(background)];
        const ratio =
          (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
        expect(ratio, `${theme} ${label} contrast`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
