/** @vitest-environment happy-dom */

import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog closable", () => {
  it("does not close on Escape or backdrop when closable is false", () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen title="Publish" onClose={onClose} closable={false}>
        <p>working</p>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    const backdrop = document.querySelector(".fixed.inset-0");
    if (backdrop) {
      fireEvent.click(backdrop);
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape when closable defaults to true", () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen title="Publish" onClose={onClose}>
        <p>ready</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
