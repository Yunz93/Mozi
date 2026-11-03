/** @vitest-environment happy-dom */

import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeBaseLoadingScreen } from "./KnowledgeBaseLoadingScreen";
import { KnowledgeBaseOnboarding } from "./KnowledgeBaseOnboarding";

const css = readFileSync(
  resolve(process.cwd(), "src/styles/workspace.css"),
  "utf8",
);
let stylesheet: HTMLStyleElement;

beforeEach(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = css;
  document.head.appendChild(stylesheet);
});

afterEach(() => {
  cleanup();
  stylesheet.remove();
  document.documentElement.classList.remove("dark");
});

describe("startup page theme consistency", () => {
  it.each([
    ["light", "loading"],
    ["dark", "loading"],
    ["light", "onboarding"],
    ["dark", "onboarding"],
  ] as const)("uses the %s workspace palette for %s", (theme, page) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const props = { uiScaleStyle: {}, uiFontFamily: "sans-serif" };
    const { container } = render(
      page === "loading" ? (
        <KnowledgeBaseLoadingScreen {...props} />
      ) : (
        <KnowledgeBaseOnboarding {...props} onOpen={() => {}} />
      ),
    );
    const tokens = getComputedStyle(document.documentElement);
    const canvas = tokens.getPropertyValue("--workspace-canvas").trim();
    const surface = getComputedStyle(container.firstElementChild!);
    expect(canvas).toMatch(/^#[\da-f]{6}$/);
    expect(surface.backgroundColor).toBe(canvas);
    expect(surface.color).toBe(
      tokens.getPropertyValue("--workspace-text").trim(),
    );
    const control = container.querySelector(
      page === "loading" ? ".workspace-startup-status" : "button",
    )!;
    expect(getComputedStyle(control).backgroundColor).toBe(
      tokens
        .getPropertyValue(
          page === "loading" ? "--workspace-menu" : "--workspace-primary-bg",
        )
        .trim(),
    );
  });
});
