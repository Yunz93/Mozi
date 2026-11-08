import { describe, expect, it, vi } from "vitest";
import { closeDocumentSession } from "./closeDocumentSession";

describe("closeDocumentSession", () => {
  it("force-saves a dirty tab before closing", async () => {
    const forceSave = vi.fn(async () => true);
    const closeTab = vi.fn();
    const onBlocked = vi.fn();

    const closed = await closeDocumentSession({
      tabId: "/vault/note.md",
      forceSave,
      closeTab,
      hasUnsavedChanges: () => true,
      isTabOpen: () => true,
      onBlocked,
    });

    expect(forceSave).toHaveBeenCalledWith(undefined, { trigger: "system" });
    expect(closeTab).toHaveBeenCalledWith("/vault/note.md");
    expect(onBlocked).not.toHaveBeenCalled();
    expect(closed).toBe(true);
  });

  it("does not close when forceSave fails", async () => {
    const forceSave = vi.fn(async () => false);
    const closeTab = vi.fn();
    const onBlocked = vi.fn();

    const closed = await closeDocumentSession({
      tabId: "/vault/note.md",
      forceSave,
      closeTab,
      hasUnsavedChanges: () => true,
      isTabOpen: () => true,
      onBlocked,
    });

    expect(closeTab).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(closed).toBe(false);
  });

  it("closes a clean tab without saving", async () => {
    const forceSave = vi.fn(async () => true);
    const closeTab = vi.fn();

    await closeDocumentSession({
      tabId: "/vault/note.md",
      forceSave,
      closeTab,
      hasUnsavedChanges: () => false,
      isTabOpen: () => true,
      onBlocked: () => {},
    });

    expect(forceSave).not.toHaveBeenCalled();
    expect(closeTab).toHaveBeenCalledWith("/vault/note.md");
  });
});
