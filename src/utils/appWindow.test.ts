import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyWindowLabel, isPrimaryAppWindow } from "./appWindow";

describe("appWindow", () => {
  it("classifies primary and secondary window labels", () => {
    expect(classifyWindowLabel("main")).toBe("main");
    expect(classifyWindowLabel("file-123-uuid")).toBe("file");
    expect(classifyWindowLabel("win-123-uuid")).toBe("window");
    expect(classifyWindowLabel("unknown")).toBe("other");
    expect(isPrimaryAppWindow("main")).toBe(true);
    expect(isPrimaryAppWindow("file-1")).toBe(false);
  });
});

describe("macOS Dock new-window menu", () => {
  const rust = readFileSync(
    resolve(process.cwd(), "src-tauri/src/native_new_window.rs"),
    "utf8",
  );
  const lib = readFileSync(
    resolve(process.cwd(), "src-tauri/src/lib.rs"),
    "utf8",
  );

  it("labels the Dock item 新建窗口 by default and New Window for en*", () => {
    expect(rust).toMatch(/if lang\.starts_with\("en"\)/);
    expect(rust).toContain('"New Window"');
    expect(rust).toContain('"新建窗口"');
  });

  it("installs a Dock menu that creates a window without invoking the Tauri command", () => {
    expect(rust).toContain("setDockMenu");
    expect(rust).toContain("crate::create_empty_window");
    expect(rust).not.toContain("crate::open_new_window");
    expect(lib).toContain("install_dock_new_window_menu");
    expect(lib).toMatch(/async fn create_empty_window/);
    expect(lib).not.toMatch(/pub(?:\(crate\))?\s+async fn open_new_window/);
    expect(lib).toMatch(/\nasync fn open_new_window\(/);
  });

  it("does not reuse the tauri command name for the ObjC action", () => {
    expect(rust).not.toMatch(/fn open_new_window\s*\(/);
    expect(rust).toContain("fn on_dock_new_window");
    expect(rust).toContain("Allocated<AnyObject>");
    expect(rust.match(/#\[unsafe\(method\(openNewWindow:\)\)\]/g)?.length).toBe(
      1,
    );
  });
});
