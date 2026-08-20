/** @vitest-environment happy-dom */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorMarkdownLanguage } from "../editorMarkdown";
import {
  findClickableEditorLinkAt,
  isModMouseEvent,
  tryOpenLivePreviewLinkAtPos,
} from "./clickableLinks";
import { livePreviewContextFacet } from "./context";
import { livePreviewLinks } from "./links";

const AWS_LINK_DOC =
  "[AWS 服务价目表说明](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/reading-service-price-list-file-for-services.html)";
const AWS_HREF =
  "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/reading-service-price-list-file-for-services.html";

describe("findClickableEditorLinkAt", () => {
  it("resolves a markdown link from the label or the destination", () => {
    const labelPos = AWS_LINK_DOC.indexOf("价");
    const urlPos = AWS_LINK_DOC.indexOf("docs.aws.amazon.com");
    expect(findClickableEditorLinkAt(AWS_LINK_DOC, labelPos)).toEqual({
      kind: "href",
      href: AWS_HREF,
    });
    expect(findClickableEditorLinkAt(AWS_LINK_DOC, urlPos)).toEqual({
      kind: "href",
      href: AWS_HREF,
    });
  });

  it("resolves wiki links but ignores embeds", () => {
    const doc = "see [[Note#heading]] and ![[Embed.png]]";
    const wikiPos = doc.indexOf("Note");
    const embedPos = doc.indexOf("Embed");
    expect(findClickableEditorLinkAt(doc, wikiPos)).toEqual({
      kind: "wiki",
      target: "Note#heading",
    });
    expect(findClickableEditorLinkAt(doc, embedPos)).toBeNull();
  });

  it("resolves angle autolinks and bare http(s) URLs", () => {
    const angled = "see <https://example.com/a-b.html> please";
    const angledPos = angled.indexOf("example");
    expect(findClickableEditorLinkAt(angled, angledPos)).toEqual({
      kind: "href",
      href: "https://example.com/a-b.html",
    });

    const bare = "see https://example.com/path.html, next";
    const barePos = bare.indexOf("example");
    expect(findClickableEditorLinkAt(bare, barePos)).toEqual({
      kind: "href",
      href: "https://example.com/path.html",
    });
  });
});

describe("isModMouseEvent", () => {
  it("accepts command or control left-clicks", () => {
    expect(
      isModMouseEvent(
        new MouseEvent("mousedown", { button: 0, metaKey: true }),
      ),
    ).toBe(true);
    expect(
      isModMouseEvent(new MouseEvent("click", { button: 0, ctrlKey: true })),
    ).toBe(true);
    expect(isModMouseEvent(new MouseEvent("click", { button: 0 }))).toBe(false);
  });
});

describe("tryOpenLivePreviewLinkAtPos", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    while (views.length) {
      const view = views.pop();
      view?.destroy();
      view?.dom.parentElement?.remove();
    }
  });

  function mount(
    doc: string,
    extras: import("@codemirror/state").Extension[] = [],
    cursor = 0,
  ) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: [createEditorMarkdownLanguage(), ...extras],
      }),
      parent,
    });
    views.push(view);
    return view;
  }

  it("opens a revealed markdown destination through onOpenLink", () => {
    const onOpenLink = vi.fn();
    const view = mount(AWS_LINK_DOC, [
      livePreviewContextFacet.of({
        sourceFilePath: null,
        rootFolderPath: null,
        files: [],
        onOpenLink,
      }),
    ]);
    const urlPos = AWS_LINK_DOC.indexOf("docs.aws");
    expect(tryOpenLivePreviewLinkAtPos(view, urlPos)).toBe(true);
    expect(onOpenLink).toHaveBeenCalledWith(AWS_HREF);
  });

  it("does not open links inside inline code", () => {
    const onOpenLink = vi.fn();
    const doc = "code `https://example.com/secret` done";
    const view = mount(doc, [
      livePreviewContextFacet.of({
        sourceFilePath: null,
        rootFolderPath: null,
        files: [],
        onOpenLink,
      }),
    ]);
    const pos = doc.indexOf("example");
    expect(tryOpenLivePreviewLinkAtPos(view, pos)).toBe(false);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("opens a collapsed markdown link widget on command-click only", () => {
    const onOpenLink = vi.fn();
    const doc = "go [here](https://example.com)\n\naway";
    const view = mount(
      doc,
      [
        livePreviewContextFacet.of({
          sourceFilePath: null,
          rootFolderPath: null,
          files: [],
          onOpenLink,
        }),
        livePreviewLinks,
      ],
      doc.length - 1,
    );
    const link = view.dom.querySelector(
      ".cm-live-preview-link",
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();

    link!.dispatchEvent(
      new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }),
    );
    expect(onOpenLink).not.toHaveBeenCalled();

    link!.dispatchEvent(
      new MouseEvent("click", {
        button: 0,
        bubbles: true,
        cancelable: true,
        metaKey: true,
      }),
    );
    expect(onOpenLink).toHaveBeenCalledWith("https://example.com");
  });
});
