/** @vitest-environment happy-dom */

import React, { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../store/appStore";

const { serializeAsJSON } = vi.hoisted(() => ({
  serializeAsJSON: vi.fn(() =>
    JSON.stringify({
      type: "excalidraw",
      elements: [{ id: "el-1" }],
    }),
  ),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  restore: (input: unknown) => input,
  serializeAsJSON,
  Excalidraw: ({
    onChange,
  }: {
    onChange: (
      elements: unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => void;
  }) => {
    useEffect(() => {
      onChange([{ id: "dirty" }], {}, {});
    }, [onChange]);
    return <div data-testid="excalidraw-mock" />;
  },
}));

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

const OBSIDIAN_MD = `---
excalidraw-plugin: parsed
---

# Note

## Drawing
\`\`\`json
{"type":"excalidraw","version":2,"elements":[],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}
\`\`\`
`;

const PLAIN_JSON = `{
  "type": "excalidraw",
  "version": 2,
  "elements": [],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
`;

describe("ExcalidrawPane tab switch flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({
      files: [
        {
          id: "/vault/a.excalidraw.md",
          name: "a.excalidraw.md",
          type: "file",
          path: "/vault/a.excalidraw.md",
        },
        {
          id: "/vault/b.excalidraw",
          name: "b.excalidraw",
          type: "file",
          path: "/vault/b.excalidraw",
        },
      ],
      openTabs: ["/vault/a.excalidraw.md", "/vault/b.excalidraw"],
      activeTabId: "/vault/a.excalidraw.md",
      fileContents: {
        "/vault/a.excalidraw.md": OBSIDIAN_MD,
        "/vault/b.excalidraw": PLAIN_JSON,
      },
      lastSavedContent: {
        "/vault/a.excalidraw.md": OBSIDIAN_MD,
        "/vault/b.excalidraw": PLAIN_JSON,
      },
      settings: { ...defaultSettings },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes the old tab back in its original wrapper format when switching tabs", async () => {
    const { ExcalidrawPane } = await import("./ExcalidrawPane");
    const { rerender } = render(
      <ExcalidrawPane onContentChange={() => undefined} />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    useAppStore.setState({ activeTabId: "/vault/b.excalidraw" });
    rerender(<ExcalidrawPane />);

    await act(async () => {
      await Promise.resolve();
    });

    const written =
      useAppStore.getState().fileContents["/vault/a.excalidraw.md"];
    expect(written).toContain("excalidraw-plugin");
    expect(written).toContain("## Drawing");
    expect(written).not.toBe(PLAIN_JSON);
  });
});
