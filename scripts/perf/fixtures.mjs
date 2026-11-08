import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const noteName = (i) => `note-${String(i).padStart(5, "0")}.md`;
export function noteContent(i, count) {
  return `---\ntitle: Note ${i}\n---\n# Note ${i}\n\nA deterministic knowledge-base sample about project ${i % 17}.\n\n## Tasks\n\n- [ ] Review project ${i % 17} 📅 2026-12-01\n\n[[${noteName((i + 1) % count).slice(0, -3)}]]\n\n![fixture](assets/sample.svg)\n\n| Name | State |\n| --- | --- |\n| Project | Open |\n`;
}
export function makeVault(count, root = "/perf-vault") {
  const files = Array.from({ length: count }, (_, i) => ({
    id: `${root}/${noteName(i)}`,
    path: `${root}/${noteName(i)}`,
    name: noteName(i),
    type: "file",
  }));
  return {
    root,
    files,
    readFile: async (filePath) => {
      const match = /note-(\d+)\.md$/.exec(filePath);
      if (!match || Number(match[1]) >= count)
        throw new Error(`Unknown fixture ${filePath}`);
      return noteContent(Number(match[1]), count);
    },
  };
}
export function longDocument(bytes) {
  const paragraph =
    "A reproducible paragraph for editing and reading. 中文排版测试。\n\n";
  return (
    "# Long document\n\n" +
    paragraph.repeat(Math.ceil(bytes / Buffer.byteLength(paragraph)))
  );
}
export async function writeFixtures(destination, counts = [100, 1000, 10000]) {
  await mkdir(destination, { recursive: true });
  for (const count of counts) {
    const root = path.join(destination, `vault-${count}`);
    await mkdir(path.join(root, "assets"), { recursive: true });
    for (let i = 0; i < count; i++)
      await writeFile(path.join(root, noteName(i)), noteContent(i, count));
    await writeFile(
      path.join(root, "assets/sample.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6"/></svg>',
    );
  }
  for (const bytes of [100_000, 1_000_000, 5_000_000])
    await writeFile(
      path.join(destination, `long-${bytes}.md`),
      longDocument(bytes),
    );
}
