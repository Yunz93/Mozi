import { describe, expect, it } from "vitest";
import {
  EXCALIDRAW_LOCAL_ASSET_PATH,
  ensureExcalidrawAssetPath,
} from "./excalidrawAssetPath";

describe("ensureExcalidrawAssetPath", () => {
  it("sets the local asset path when unset", () => {
    const target: { EXCALIDRAW_ASSET_PATH?: string | string[] } = {};
    expect(ensureExcalidrawAssetPath(target)).toBe(EXCALIDRAW_LOCAL_ASSET_PATH);
    expect(target.EXCALIDRAW_ASSET_PATH).toBe("/");
  });

  it("does not overwrite an existing path", () => {
    const target = { EXCALIDRAW_ASSET_PATH: "https://cdn.example/" };
    expect(ensureExcalidrawAssetPath(target)).toBe("https://cdn.example/");
  });

  it("returns null when there is no window-like target", () => {
    expect(ensureExcalidrawAssetPath(undefined)).toBeNull();
  });
});
