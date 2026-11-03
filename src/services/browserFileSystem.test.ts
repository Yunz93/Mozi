import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/appStore", () => ({
  useAppStore: { getState: () => ({ settings: { trashFolder: ".trash" } }) },
}));

import { BrowserFileSystem } from "./browserFileSystem";

type Entry = {
  name: string;
  kind: "file" | "directory";
  bytes: Uint8Array;
  children: Map<string, Entry>;
};

function createFixture(caseSensitive = false) {
  const root: Entry = {
    name: "vault",
    kind: "directory",
    bytes: new Uint8Array(),
    children: new Map(),
  };
  let fail:
    | ((operation: "write" | "remove", path: string) => boolean)
    | undefined;
  const handles = new WeakMap<object, string>();
  const key = (name: string) => (caseSensitive ? name : name.toLowerCase());
  const missing = () => new DOMException("Missing entry", "NotFoundError");

  function handle(entry: Entry, path: string): FileSystemHandle {
    const result = {
      kind: entry.kind,
      name: path.split("/").pop()!,
      // 模拟 Chromium 的路径序列化比较：磁盘别名并不保证返回 true。
      isSameEntry: async (other: FileSystemHandle) =>
        handles.get(other) === path,
      async getFile() {
        const snapshot = entry.bytes.slice();
        return {
          name: entry.name,
          text: async () => new TextDecoder().decode(snapshot),
          arrayBuffer: async () => snapshot.buffer,
        };
      },
      async createWritable() {
        let pending = entry.bytes.slice();
        return {
          async write(value: ArrayBuffer | Uint8Array) {
            if (fail?.("write", path))
              throw new Error("Injected write failure");
            pending = new Uint8Array(value).slice();
          },
          async close() {
            entry.bytes = pending;
          },
          async abort() {},
        };
      },
      async getFileHandle(name: string, options: { create?: boolean } = {}) {
        return getChild(name, "file", options.create);
      },
      async getDirectoryHandle(
        name: string,
        options: { create?: boolean } = {},
      ) {
        return getChild(name, "directory", options.create);
      },
      async *entries() {
        for (const child of entry.children.values()) {
          yield [child.name, handle(child, `${path}/${child.name}`)];
        }
      },
      async resolve(other: FileSystemHandle) {
        const otherPath = handles.get(other)!;
        return otherPath === path
          ? []
          : otherPath.startsWith(`${path}/`)
            ? otherPath.slice(path.length + 1).split("/")
            : null;
      },
      async removeEntry(name: string) {
        if (fail?.("remove", `${path}/${name}`))
          throw new Error("Injected remove failure");
        if (!entry.children.delete(key(name))) throw missing();
      },
    };
    function getChild(name: string, kind: Entry["kind"], create?: boolean) {
      let child = entry.children.get(key(name));
      if (!child) {
        if (!create) throw missing();
        child = { name, kind, bytes: new Uint8Array(), children: new Map() };
        entry.children.set(key(name), child);
      }
      if (child.kind !== kind)
        throw new DOMException("Wrong entry kind", "TypeMismatchError");
      return handle(child, `${path}/${name}`);
    }
    handles.set(result, path);
    return result as unknown as FileSystemHandle;
  }

  function add(path: string, content?: Uint8Array) {
    const parts = path.split("/");
    let current = root;
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index]!;
      let child = current.children.get(key(name));
      if (!child) {
        child = {
          name,
          kind: index === parts.length - 1 && content ? "file" : "directory",
          bytes: content?.slice() ?? new Uint8Array(),
          children: new Map(),
        };
        current.children.set(key(name), child);
      }
      current = child;
    }
    return current;
  }

  const fs = new BrowserFileSystem();
  const directory = handle(root, "vault") as FileSystemDirectoryHandle;
  Object.assign(fs, { directoryHandle: directory, rootPath: "vault" });
  return {
    fs,
    root,
    directory,
    add,
    setFailure: (value: typeof fail) => {
      fail = value;
    },
  };
}

const bytes = new Uint8Array([0, 255, 128, 1]);

afterEach(() => vi.restoreAllMocks());

describe("BrowserFileSystem safe rename", () => {
  it("keeps case-only file renames intact even when raw handles compare unequal", async () => {
    const fixture = createFixture();
    fixture.add("Note.md", bytes);
    const oldHandle = await fixture.directory.getFileHandle("Note.md");
    const alias = await fixture.directory.getFileHandle("note.md");
    expect(await oldHandle.isSameEntry(alias)).toBe(false);

    expect(
      await fixture.fs.renameEntry("vault/Note.md", "note.md", false),
    ).toBe("vault/note.md");
    expect(
      [...fixture.root.children.values()].map((entry) => entry.name),
    ).toEqual(["note.md"]);
    expect(await fixture.fs.readBinaryFile("vault/note.md")).toEqual(bytes);
  });

  it("also protects the legacy renameFile entry point and binary contents", async () => {
    const fixture = createFixture();
    fixture.add("Cover.png", bytes);
    await fixture.fs.renameFile("vault/Cover.png", "cover.png");
    expect(await fixture.fs.readBinaryFile("vault/cover.png")).toEqual(bytes);
  });

  it("renames a nonempty folder through a complete backup", async () => {
    const fixture = createFixture();
    fixture.add("Notes/nested/note.md", bytes);
    await fixture.fs.renameEntry("vault/Notes", "notes", true);
    expect(
      [...fixture.root.children.values()].map((entry) => entry.name),
    ).toEqual(["notes"]);
    expect(
      await fixture.fs.readBinaryFile("vault/notes/nested/note.md"),
    ).toEqual(bytes);
  });

  it.each([false, true])(
    "preserves the source when staging a %s-directory entry fails",
    async (directory) => {
      const fixture = createFixture();
      fixture.add(directory ? "Notes/note.md" : "Notes", bytes);
      fixture.setFailure(
        (operation, path) =>
          operation === "write" && path.includes(".mozi-rename-"),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        fixture.fs.renameEntry("vault/Notes", "notes", directory),
      ).rejects.toThrow("Injected write failure");
      expect(
        await fixture.fs.readBinaryFile(
          directory ? "vault/Notes/note.md" : "vault/Notes",
        ),
      ).toEqual(bytes);
      expect(
        [...fixture.root.children.values()].map((entry) => entry.name),
      ).toEqual(["Notes"]);
    },
  );

  it.each([false, true])(
    "restores a %s-directory entry when the final copy fails",
    async (directory) => {
      const fixture = createFixture();
      fixture.add(directory ? "Notes/note.md" : "Notes", bytes);
      fixture.setFailure(
        (operation, path) =>
          operation === "write" && path.startsWith("vault/notes"),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        fixture.fs.renameEntry("vault/Notes", "notes", directory),
      ).rejects.toThrow("Injected write failure");
      expect(
        await fixture.fs.readBinaryFile(
          directory ? "vault/Notes/note.md" : "vault/Notes",
        ),
      ).toEqual(bytes);
      expect(
        [...fixture.root.children.values()].map((entry) => entry.name),
      ).toEqual(["Notes"]);
    },
  );

  it("retains and identifies the complete backup if rollback also fails", async () => {
    const fixture = createFixture();
    fixture.add("Note.md", bytes);
    fixture.setFailure(
      (operation, path) =>
        operation === "write" && !path.includes(".mozi-rename-"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      fixture.fs.renameEntry("vault/Note.md", "note.md", false),
    ).rejects.toThrow(/preserved at vault\/\.mozi-rename-/);
    const backup = [...fixture.root.children.values()].find((entry) =>
      entry.name.startsWith(".mozi-rename-"),
    );
    expect(backup?.bytes).toEqual(bytes);
  });

  it("restores the whole folder after a recursive removal fails partway through", async () => {
    const fixture = createFixture();
    fixture.add("Notes/first.md", bytes);
    fixture.add("Notes/second.md", new Uint8Array([2]));
    let firstRemoval = true;
    fixture.setFailure((operation, path) => {
      if (operation !== "remove" || path !== "vault/Notes" || !firstRemoval)
        return false;
      firstRemoval = false;
      fixture.root.children.get("notes")!.children.delete("first.md");
      return true;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      fixture.fs.renameEntry("vault/Notes", "notes", true),
    ).rejects.toThrow("Injected remove failure");

    expect(await fixture.fs.readBinaryFile("vault/Notes/first.md")).toEqual(
      bytes,
    );
    expect(await fixture.fs.readBinaryFile("vault/Notes/second.md")).toEqual(
      new Uint8Array([2]),
    );
    expect(
      [...fixture.root.children.values()].map((entry) => entry.name),
    ).toEqual(["Notes"]);
  });

  it("rejects a distinct existing target on a case-sensitive volume", async () => {
    const fixture = createFixture(true);
    fixture.add("Note.md", bytes);
    fixture.add("note.md", new Uint8Array([2]));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      fixture.fs.renameEntry("vault/Note.md", "note.md", false),
    ).rejects.toThrow(/already exists/);
    expect(await fixture.fs.readBinaryFile("vault/Note.md")).toEqual(bytes);
    expect(await fixture.fs.readBinaryFile("vault/note.md")).toEqual(
      new Uint8Array([2]),
    );
  });

  it("does not delete a file moved to a different spelling of its own parent", async () => {
    const fixture = createFixture();
    fixture.add("Notes/note.md", bytes);
    expect(
      await fixture.fs.moveFile("vault/Notes/note.md", "vault/notes"),
    ).toBe("vault/Notes/note.md");
    expect(await fixture.fs.readBinaryFile("vault/Notes/note.md")).toEqual(
      bytes,
    );
  });

  it("rejects moving a directory into a case alias of its descendant", async () => {
    const fixture = createFixture();
    fixture.add("Notes/nested/note.md", bytes);
    await expect(
      fixture.fs.moveFile("vault/Notes", "vault/notes/nested"),
    ).rejects.toThrow(/itself|descendant/);
    expect(
      await fixture.fs.readBinaryFile("vault/Notes/nested/note.md"),
    ).toEqual(bytes);
  });

  it("still supports ordinary file and directory moves", async () => {
    const fixture = createFixture();
    fixture.add("Note.md", bytes);
    fixture.add("Notes/nested/note.md", bytes);
    fixture.add("target");
    expect(await fixture.fs.moveFile("vault/Note.md", "vault/target")).toBe(
      "vault/target/Note.md",
    );
    expect(await fixture.fs.moveFile("vault/Notes", "vault/target")).toBe(
      "vault/target/Notes",
    );
    expect(await fixture.fs.readBinaryFile("vault/target/Note.md")).toEqual(
      bytes,
    );
    expect(
      await fixture.fs.readBinaryFile("vault/target/Notes/nested/note.md"),
    ).toEqual(bytes);
    expect(
      [...fixture.root.children.values()].map((entry) => entry.name),
    ).toEqual(["target"]);
  });
});
