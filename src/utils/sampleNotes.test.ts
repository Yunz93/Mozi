/** @vitest-environment happy-dom */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";
import { renderMarkdown } from "./markdown";

const root = resolve(import.meta.dirname, "../..");
const samples = join(root, "src-tauri/resources/sample-notes");
const fixture = join(root, "docs/fixtures/retrieval-eval/vault");
const notes = readdirSync(samples).filter((name) => name.endsWith(".md"));

describe("bundled sample notes", () => {
  it("keeps the retrieval fixture identical to the four shipped notes", () => {
    expect(notes).toHaveLength(4);
    expect(notes).toContain("03-功能导览.md");
    for (const name of notes) {
      expect(readFileSync(join(fixture, name), "utf8")).toBe(
        readFileSync(join(samples, name), "utf8"),
      );
    }
  });

  it("renders the getting-started navigation as two columns with working Wiki links", () => {
    const { body } = parseFrontmatter(
      readFileSync(join(samples, "00-快速上手.md"), "utf8"),
    );
    const doc = new DOMParser().parseFromString(
      renderMarkdown(body),
      "text/html",
    );
    const rows = [...doc.querySelectorAll("table:first-of-type tbody tr")];
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(row.querySelectorAll("td")).toHaveLength(2);
    const links = [
      ...doc.querySelectorAll("table:first-of-type [data-wikilink]"),
    ];
    expect(links).toHaveLength(7);
    expect(links.map((link) => link.textContent)).toContain(
      "Markdown 排版练习",
    );
    for (const link of links) {
      const target = link.getAttribute("data-wikilink")!;
      expect(target).toBe(target.trim());
      const [name, heading] = target.split("#");
      const text = readFileSync(join(samples, name + ".md"), "utf8");
      if (heading) expect(text).toContain("## " + heading);
    }
  });

  it("ships rendered sample images together in resources without an assets directory", () => {
    expect(existsSync(join(samples, "assets"))).toBe(false);
    const images: string[] = [];
    for (const name of notes) {
      const { body } = parseFrontmatter(
        readFileSync(join(samples, name), "utf8"),
      );
      const doc = new DOMParser().parseFromString(
        renderMarkdown(body),
        "text/html",
      );
      images.push(
        ...[...doc.querySelectorAll("img")].map(
          (image) => image.getAttribute("src")!,
        ),
      );
    }
    expect(images.length).toBeGreaterThan(20);
    for (const image of images) {
      expect(dirname(image)).toBe("resources");
      expect(existsSync(join(samples, image))).toBe(true);
    }
  });

  it("uses the same existing local screenshots in both READMEs", () => {
    const getImages = (name: string) =>
      [
        ...readFileSync(join(root, name), "utf8").matchAll(
          /<img\b[^>]*src="([^"]+)"/g,
        ),
      ].map((match) => match[1]);
    const images = getImages("README.md");
    expect(images.length).toBeGreaterThan(20);
    expect(getImages("README.en.md")).toEqual(images);
    for (const image of images) {
      expect(image).toMatch(
        /^\.\/src-tauri\/resources\/sample-notes\/resources\//,
      );
      expect(existsSync(join(root, image))).toBe(true);
    }
  });
});
