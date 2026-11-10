/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { installFileDropNavigationGuard } from "./fileDropNavigationGuard";

let remove: (() => void) | undefined;
afterEach(() => {
  remove?.();
  remove = undefined;
  document.body.replaceChildren();
});
function drop(
  types: string[],
  options: {
    target?: Element;
    text?: string;
    files?: File[];
    eventType?: string;
  } = {},
) {
  const event = new Event(options.eventType ?? "drop", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types,
      files: options.files ?? [],
      getData: () => options.text ?? "",
    },
  });
  (options.target ?? document.body).dispatchEvent(event);
  return event;
}
it.each(["Files", "application/x-moz-file", "text/uri-list"])(
  "blocks unhandled %s drops before the browser opens a new document",
  (type) => {
    remove = installFileDropNavigationGuard();
    expect(drop([type]).defaultPrevented).toBe(true);
    expect(drop([type], { eventType: "dragover" }).defaultPrevented).toBe(true);
  },
);
it("blocks file references supplied as plain text and FileList without reported types", () => {
  remove = installFileDropNavigationGuard();
  expect(
    drop(["text/plain"], { text: "file:///vault/note.md" }).defaultPrevented,
  ).toBe(true);
  expect(
    drop([], { files: [new File(["fixture"], "slide.pptx")] }).defaultPrevented,
  ).toBe(true);
});
it("leaves normal text drops and native input behavior available", () => {
  remove = installFileDropNavigationGuard();
  expect(
    drop(["text/plain"], { text: "normal editor text" }).defaultPrevented,
  ).toBe(false);
  const input = document.createElement("input");
  document.body.append(input);
  expect(drop(["Files"], { target: input }).defaultPrevented).toBe(false);
});
it("lets an editor receive an unprevented drop first and preserves its own processing", () => {
  remove = installFileDropNavigationGuard();
  const editor = document.createElement("div");
  document.body.append(editor);
  const handler = vi.fn((event: Event) => {
    expect(event.defaultPrevented).toBe(false);
    event.preventDefault();
    event.stopPropagation();
  });
  editor.addEventListener("drop", handler);
  expect(drop(["Files"], { target: editor }).defaultPrevented).toBe(true);
  expect(handler).toHaveBeenCalledOnce();
});
it("still cancels navigation after a capture listener removes the drop target", () => {
  remove = installFileDropNavigationGuard();
  const shortcut = document.createElement("div");
  document.body.append(shortcut);
  document.addEventListener("drop", () => shortcut.remove(), {
    capture: true,
    once: true,
  });
  expect(drop(["Files"], { target: shortcut }).defaultPrevented).toBe(true);
});
it("removes its fallback when disposed", () => {
  remove = installFileDropNavigationGuard();
  remove();
  remove = undefined;
  expect(drop(["Files"]).defaultPrevented).toBe(false);
});
