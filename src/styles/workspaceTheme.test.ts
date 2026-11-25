/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const workspaceCss = ["workspace.css", "workspace-settings.css"]
  .map((name) => readFileSync(resolve(process.cwd(), "src/styles", name), "utf8"))
  .join("\n");

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

  it.each(["light", "dark"])(
    "matches the settings navigation to the workspace in %s mode",
    (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      workspace.insertAdjacentHTML(
        "beforeend",
        `<div class="workspace-settings">
          <aside class="workspace-settings-nav">
            <button class="workspace-settings-nav-button is-active">关于</button>
          </aside>
        </div>`,
      );

      const navigation = workspace.querySelector(".workspace-settings-nav")!;
      const active = navigation.querySelector("button")!;
      expect(getComputedStyle(navigation).backgroundColor).toBe(
        getComputedStyle(workspace).backgroundColor,
      );
      expect(getComputedStyle(active).backgroundColor).toBe(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--workspace-active")
          .trim(),
      );
    },
  );
});
