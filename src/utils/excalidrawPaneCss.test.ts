import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("excalidraw pane CSS isolation", () => {
  it("keeps the bound-text editor from inheriting app text-sm metrics", () => {
    const css = readFileSync(resolve(process.cwd(), "index.css"), "utf8");
    expect(css).toMatch(/\.excalidraw-pane\s*\{[^}]*font-size:\s*16px;/m);
    expect(css).toMatch(
      /\.excalidraw-pane textarea\.excalidraw-wysiwyg[^}]*white-space:\s*pre-wrap\s*!important;/m,
    );
  });
});
