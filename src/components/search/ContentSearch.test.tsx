/** @vitest-environment happy-dom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore, defaultSettings } from "../../store/appStore";
import { ContentSearch } from "./ContentSearch";

beforeEach(() => {
  useAppStore.setState({ settings: { ...defaultSettings, language: "zh-CN" } });
});

afterEach(() => {
  cleanup();
});

describe("ContentSearch", () => {
  it("shows Find and Replace as peer tabs without an eye toggle", () => {
    render(<ContentSearch onClose={() => {}} />);

    const findTab = screen.getByRole("button", { name: "查找" });
    const replaceTab = screen.getByRole("button", { name: "替换" });

    expect(findTab.getAttribute("aria-pressed")).toBe("true");
    expect(replaceTab.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByPlaceholderText("替换为...")).toBeNull();
    expect(screen.queryByText("隐藏")).toBeNull();

    fireEvent.click(replaceTab);

    expect(findTab.getAttribute("aria-pressed")).toBe("false");
    expect(replaceTab.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByPlaceholderText("替换为...")).toBeTruthy();
    expect(screen.queryByText("隐藏")).toBeNull();

    fireEvent.click(findTab);

    expect(findTab.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByPlaceholderText("替换为...")).toBeNull();
  });
});
