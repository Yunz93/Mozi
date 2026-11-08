import { describe, expect, it } from "vitest";
import type { FileNode } from "../../types";
import {
  buildFullLinkIndex,
  createEmptyLinkIndex,
  getBacklinks,
  getOutbounds,
  getUnresolvedOutbounds,
  reconcileTreeWithIndex,
  reindexFileContents,
  remapPathsInIndex,
  removeFilesFromIndex,
} from "./linkIndexService";

function file(path: string, name: string): FileNode {
  return { id: path, name, type: "file", path };
}

const vaultFiles: FileNode[] = [
  file("/vault/Alpha.md", "Alpha.md"),
  file("/vault/Beta.md", "Beta.md"),
  file("/vault/Gamma.md", "Gamma.md"),
];

const contents: Record<string, string> = {
  "/vault/Alpha.md": "Links [[Beta]] and [[Missing]].",
  "/vault/Beta.md": "Back to [[Alpha#Intro]].",
  "/vault/Gamma.md": "No links here.",
};

describe("linkIndexService", () => {
  it("deduplicates common targets in source order and handles prototype-like unresolved names", async () => {
    const files = Array.from({ length: 1000 }, (_, i) =>
      file(`/vault/n${i}.md`, `n${i}.md`),
    );
    const index = await buildFullLinkIndex({
      files,
      vaultRoot: "/vault",
      readFile: async () =>
        "[[n0]] [[n0]] [[__proto__]] [[constructor]] [[__proto__]]",
    });
    const paths = files.map((node) => node.path);
    expect(index.inbounds["/vault/n0.md"]).toEqual(paths);
    expect(index.unresolved["__proto__"]).toEqual(paths);
    expect(index.unresolved["constructor"]).toEqual(paths);
    expect(JSON.parse(JSON.stringify(index)).unresolved["__proto__"]).toEqual(
      paths,
    );
  });
  it("builds a full index with backlinks and unresolved targets", async () => {
    const snapshot = await buildFullLinkIndex({
      files: vaultFiles,
      vaultRoot: "/vault",
      readFile: async (path) => contents[path] ?? "",
    });

    expect(getOutbounds(snapshot, "/vault/Alpha.md")).toHaveLength(2);
    expect(getUnresolvedOutbounds(snapshot, "/vault/Alpha.md")).toHaveLength(1);

    const betaBacklinks = getBacklinks(snapshot, "/vault/Beta.md");
    expect(betaBacklinks).toHaveLength(1);
    expect(betaBacklinks[0]?.sourcePath).toBe("/vault/Alpha.md");

    const alphaBacklinks = getBacklinks(snapshot, "/vault/Alpha.md");
    expect(alphaBacklinks[0]?.sourcePath).toBe("/vault/Beta.md");
  });

  it("reindexes a single file after content change", async () => {
    let snapshot = await buildFullLinkIndex({
      files: vaultFiles,
      vaultRoot: "/vault",
      readFile: async (path) => contents[path] ?? "",
    });

    snapshot = await reindexFileContents({
      snapshot,
      pathContents: {
        "/vault/Alpha.md": "Only [[Gamma]] now.",
      },
      files: vaultFiles,
      vaultRoot: "/vault",
    });

    expect(getBacklinks(snapshot, "/vault/Beta.md")).toHaveLength(0);
    expect(getBacklinks(snapshot, "/vault/Gamma.md")[0]?.sourcePath).toBe(
      "/vault/Alpha.md",
    );
  });

  it("removes and remaps paths", () => {
    const snapshot = createEmptyLinkIndex("/vault");
    snapshot.outbounds["/vault/Alpha.md"] = [
      {
        sourcePath: "/vault/Alpha.md",
        raw: "[[Beta]]",
        targetRaw: "Beta",
        displayText: "Beta",
        resolvedPath: "/vault/Beta.md",
        isEmbed: false,
        subpath: "",
        subpathType: null,
        startOffset: 0,
        endOffset: 8,
      },
    ];
    snapshot.inbounds["/vault/Beta.md"] = ["/vault/Alpha.md"];

    const remapped = remapPathsInIndex(snapshot, {
      "/vault/Alpha.md": "/vault/renamed/Alpha.md",
      "/vault/Beta.md": "/vault/renamed/Beta.md",
    });
    expect(
      remapped.outbounds["/vault/renamed/Alpha.md"]?.[0]?.resolvedPath,
    ).toBe("/vault/renamed/Beta.md");

    const removed = removeFilesFromIndex(remapped, ["/vault/renamed/Alpha.md"]);
    expect(removed.outbounds["/vault/renamed/Alpha.md"]).toBeUndefined();
    expect(getBacklinks(removed, "/vault/renamed/Beta.md")).toHaveLength(0);
  });

  it("reconciles tree additions and removals", async () => {
    const snapshot = await buildFullLinkIndex({
      files: vaultFiles,
      vaultRoot: "/vault",
      readFile: async (path) => contents[path] ?? "",
    });

    const nextFiles = [
      file("/vault/Alpha.md", "Alpha.md"),
      file("/vault/Delta.md", "Delta.md"),
    ];
    const { toAdd, toRemove } = reconcileTreeWithIndex({
      snapshot,
      files: nextFiles,
    });

    expect(toAdd).toContain("/vault/Delta.md");
    expect(toRemove).toEqual(
      expect.arrayContaining(["/vault/Beta.md", "/vault/Gamma.md"]),
    );
  });
});
