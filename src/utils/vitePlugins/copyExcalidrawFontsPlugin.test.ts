import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyExcalidrawFonts } from "./copyExcalidrawFontsPlugin";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("copyExcalidrawFonts", () => {
  it("copies a fonts tree into the destination", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "excalidraw-fonts-"));
    tempDirs.push(root);
    const source = path.join(root, "source");
    const dest = path.join(root, "public", "fonts");
    fs.mkdirSync(path.join(source, "Virgil"), { recursive: true });
    fs.writeFileSync(path.join(source, "Virgil", "sample.woff2"), "font");

    const result = copyExcalidrawFonts({ source, dest });
    expect(result.copied).toBe(true);
    expect(fs.existsSync(path.join(dest, "Virgil", "sample.woff2"))).toBe(true);
  });

  it("reports missing source without throwing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "excalidraw-fonts-"));
    tempDirs.push(root);
    const result = copyExcalidrawFonts({
      source: path.join(root, "missing"),
      dest: path.join(root, "public", "fonts"),
    });
    expect(result.copied).toBe(false);
  });
});
