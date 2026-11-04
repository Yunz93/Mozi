/** @vitest-environment happy-dom */

import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAYOUT } from "../config/layout";
import { ViewMode } from "../types";
import { useSidebarResize } from "../components/sidebar/hooks/useSidebarResize";
import { useWorkspaceLayout } from "./useWorkspaceLayout";

function Harness() {
  const [activeTabId, setActiveTabId] = useState<string | null>(
    "/test/note.md",
  );
  const layout = useWorkspaceLayout({
    activeTabId,
    isSidebarOpen: true,
    viewMode: ViewMode.LIVE,
  });
  const resize = useSidebarResize({ onWidthChange: layout.setSidebarWidth });
  return (
    <div>
      <aside data-testid="sidebar" data-width={layout.responsiveSidebarWidth}>
        <div data-testid="resize" onMouseDown={resize.handleResizeStart} />
      </aside>
      <main ref={layout.mainContentRef} />
      <button onClick={() => layout.setIsOutlineOpen((value) => !value)}>
        大纲
      </button>
      <button onClick={() => setActiveTabId(null)}>关闭笔记</button>
      <output data-testid="outline-width">
        {layout.responsiveOutlineWidth}
      </output>
    </div>
  );
}

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  act(() => window.dispatchEvent(new Event("resize")));
}
function dragSidebar(to: number) {
  fireEvent.mouseDown(screen.getByTestId("resize"), {
    button: 0,
    clientX: 200,
  });
  fireEvent.mouseMove(document, { clientX: to });
  fireEvent.mouseUp(document);
}
function sidebarWidth() {
  return Number(screen.getByTestId("sidebar").dataset.width);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setViewport(1024);
});

describe("sidebar resizing in windowed layouts", () => {
  it("can resize at the native minimum window width", () => {
    setViewport(960);
    render(<Harness />);
    dragSidebar(300);
    expect(sidebarWidth()).toBe(300);
    dragSidebar(220);
    expect(sidebarWidth()).toBe(220);
  });
  it("can resize with the outline open in a normal 1200px window", () => {
    setViewport(1200);
    render(<Harness />);
    fireEvent.click(screen.getByText("大纲"));
    dragSidebar(280);
    expect(sidebarWidth()).toBe(280);
    dragSidebar(220);
    expect(sidebarWidth()).toBe(220);
  });
  it("keeps a usable document width and restores the chosen width when the window grows", () => {
    setViewport(1440);
    render(<Harness />);
    fireEvent.click(screen.getByText("大纲"));
    dragSidebar(400);
    expect(sidebarWidth()).toBe(400);
    setViewport(960);
    const outline = Number(screen.getByTestId("outline-width").textContent);
    const reserved = outline + LAYOUT.GAP.OUTLINE_PANEL + LAYOUT.GAP.SHELL_EDGE;
    expect(sidebarWidth()).toBeGreaterThanOrEqual(LAYOUT.SIDEBAR.MIN_WIDTH);
    expect(960 - sidebarWidth() - reserved).toBeGreaterThanOrEqual(
      LAYOUT.SPLIT_PANE.MIN_WIDTH,
    );
    expect(localStorage.getItem(LAYOUT.STORAGE_KEYS.SIDEBAR_WIDTH)).toBe("400");
    setViewport(1440);
    expect(sidebarWidth()).toBe(400);
  });
  it("does not reserve outline space after the last document is closed", () => {
    setViewport(1440);
    render(<Harness />);
    fireEvent.click(screen.getByText("大纲"));
    dragSidebar(400);
    setViewport(960);
    expect(sidebarWidth()).toBeLessThan(400);
    fireEvent.click(screen.getByText("关闭笔记"));
    expect(sidebarWidth()).toBe(400);
  });
  it("keeps desktop resize limits and leaves the mobile drawer unchanged", () => {
    setViewport(1440);
    render(<Harness />);
    dragSidebar(800);
    expect(sidebarWidth()).toBe(LAYOUT.SIDEBAR.MAX_WIDTH);
    dragSidebar(20);
    expect(sidebarWidth()).toBe(LAYOUT.SIDEBAR.MIN_WIDTH);
    setViewport(740);
    dragSidebar(400);
    expect(localStorage.getItem(LAYOUT.STORAGE_KEYS.SIDEBAR_WIDTH)).toBe(
      String(LAYOUT.SIDEBAR.MIN_WIDTH),
    );
  });
});
