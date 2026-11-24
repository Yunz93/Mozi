/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const workspaceCss = readFileSync(
  resolve(process.cwd(), "src/styles/workspace.css"),
  "utf8",
);

let style: HTMLStyleElement;
let workspace: HTMLElement;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = workspaceCss;
  document.head.appendChild(style);

  workspace = document.createElement("main");
  workspace.className = "workspace-root";
  workspace.innerHTML = `
    <aside class="sidebar-shell"></aside>
    <div class="editor-pane-layout"></div>
    <aside class="outline-panel right-rail"></aside>
  `;
  document.body.appendChild(workspace);
});

afterEach(() => {
  style.remove();
  workspace.remove();
  document.documentElement.classList.remove("dark");
});

describe("workspace background", () => {
  it.each(["light", "dark"])(
    "matches both sidebars to the editor in %s mode",
    (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      const canvas = getComputedStyle(document.documentElement)
        .getPropertyValue("--workspace-canvas")
        .trim();
      expect(canvas).toMatch(/^#[\da-f]{6}$/);
      expect(
        Array.from(workspace.children, (pane) =>
          getComputedStyle(pane).backgroundColor,
        ),
      ).toEqual([canvas, canvas, canvas]);
    },
  );
});
