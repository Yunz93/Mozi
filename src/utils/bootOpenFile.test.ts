import { describe, expect, it } from "vitest";
import {
  buildOpenFileWindowUrl,
  shouldRestoreVaultOnBoot,
  takeBootOpenFileQuery,
} from "./bootOpenFile";

describe("bootOpenFile", () => {
  it("treats OS file launches as standalone (no vault restore)", () => {
    expect(
      shouldRestoreVaultOnBoot({ pendingBootPathCount: 1, withVault: false }),
    ).toBe(false);
  });

  it("restores vault when withVault is requested or there is no boot file", () => {
    expect(
      shouldRestoreVaultOnBoot({ pendingBootPathCount: 1, withVault: true }),
    ).toBe(true);
    expect(
      shouldRestoreVaultOnBoot({ pendingBootPathCount: 0, withVault: false }),
    ).toBe(true);
  });

  it("parses openFile and withVault from the boot query", () => {
    const result = takeBootOpenFileQuery(
      "https://app.local/index.html?openFile=%2Ftmp%2Fnote.md&withVault=1",
      false,
    );
    expect(result).toEqual({
      paths: ["/tmp/note.md"],
      withVault: true,
    });
  });

  it("defaults withVault to false for system openFile links", () => {
    const result = takeBootOpenFileQuery(
      "https://app.local/index.html?openFile=/tmp/a.md",
      false,
    );
    expect(result.withVault).toBe(false);
    expect(result.paths).toEqual(["/tmp/a.md"]);
  });

  it("builds window URLs with optional withVault", () => {
    expect(buildOpenFileWindowUrl("/tmp/a.md")).toBe(
      "index.html?openFile=%2Ftmp%2Fa.md",
    );
    expect(buildOpenFileWindowUrl("/tmp/a.md", { withVault: true })).toBe(
      "index.html?openFile=%2Ftmp%2Fa.md&withVault=1",
    );
  });
});
