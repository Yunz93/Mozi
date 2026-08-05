// @vitest-environment happy-dom

import React, { useEffect, useRef } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewMode } from "../types";
import { useAppStore } from "../store/appStore";
import { defaultSettings } from "../store/uiStore";
import {
  getShortcutCandidates,
  useGlobalKeyboardShortcuts,
} from "./useKeyboardShortcuts";

describe("getShortcutCandidates", () => {
  it("keeps the configured shortcut first for non-aliased actions", () => {
    expect(getShortcutCandidates("save", "Cmd+S")).toEqual(["Cmd+S"]);
  });

  it("adds stable fallback aliases for opening settings", () => {
    expect(getShortcutCandidates("settings", "Cmd+0")).toEqual([
      "Cmd+0",
      "Ctrl+0",
      "Cmd+,",
      "Ctrl+,",
      "Command+,",
      "Meta+,",
    ]);
  });

  it("deduplicates configured values that already overlap with aliases", () => {
    expect(getShortcutCandidates("settings", "Cmd+,")).toEqual([
      "Cmd+,",
      "Cmd+0",
      "Ctrl+0",
      "Ctrl+,",
      "Command+,",
      "Meta+,",
    ]);
  });
});

describe("useGlobalKeyboardShortcuts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs save after editor keydown handlers can flush pending content", async () => {
    const events: string[] = [];

    useAppStore.setState({
      settings: {
        ...defaultSettings,
        shortcuts: {
          ...defaultSettings.shortcuts,
          save: "Cmd+S",
        },
      },
      viewMode: ViewMode.LIVE,
      lastNonSplitViewMode: ViewMode.LIVE,
    });

    function Harness() {
      const targetRef = useRef<HTMLDivElement>(null);

      useGlobalKeyboardShortcuts(
        async () => {
          events.push("save");
        },
        async () => {},
      );

      useEffect(() => {
        const target = targetRef.current;
        if (!target) return;

        const handleKeyDown = () => {
          events.push("editor-keydown");
        };

        target.addEventListener("keydown", handleKeyDown);
        return () => target.removeEventListener("keydown", handleKeyDown);
      }, []);

      return React.createElement("div", { ref: targetRef, tabIndex: 0 });
    }

    const { container } = render(React.createElement(Harness));
    const target = container.querySelector("div");
    expect(target).not.toBeNull();

    fireEvent.keyDown(target as HTMLDivElement, {
      key: "s",
      code: "KeyS",
      metaKey: true,
    });

    expect(events).toEqual(["editor-keydown"]);

    await waitFor(() => {
      expect(events).toEqual(["editor-keydown", "save"]);
    });
  });
});
