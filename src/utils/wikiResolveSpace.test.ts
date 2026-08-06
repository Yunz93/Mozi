import { describe, expect, it } from "vitest";
import type { FileNode } from "../types";
import { resolveWikiLinkFile } from "./wikiLinks";
import { extractAndResolveOutboundWikiLinks } from "./wikiOutbound";

const vault: FileNode[] = [
  {
    id: "1",
    name: "基于 Obsidian 构建个人知识库.md",
    type: "file",
    path: "/vault/01-Blog/Share/基于 Obsidian 构建个人知识库.md",
  },
  {
    id: "2",
    name: "current.md",
    type: "file",
    path: "/vault/notes/current.md",
  },
];

describe("resolve Chinese spaced blog path", () => {
  it("resolves full relative path", () => {
    expect(
      resolveWikiLinkFile(
        vault,
        "01-Blog/Share/基于 Obsidian 构建个人知识库",
        "/vault",
        "/vault/notes/current.md",
      )?.path,
    ).toBe("/vault/01-Blog/Share/基于 Obsidian 构建个人知识库.md");
  });

  it("extracts alias link and resolves", () => {
    const content =
      "[[01-Blog/Share/基于 Obsidian 构建个人知识库|基于 Ob 构建个人知识库]]";
    const links = extractAndResolveOutboundWikiLinks(
      "/vault/notes/current.md",
      content,
      vault,
      "/vault",
    );
    expect(links[0]?.resolvedPath).toBe(
      "/vault/01-Blog/Share/基于 Obsidian 构建个人知识库.md",
    );
    expect(links[0]?.targetRaw).toBe(
      "01-Blog/Share/基于 Obsidian 构建个人知识库",
    );
  });
});
