import { describe, expect, it } from "vitest";
import { getStartupKnowledgeBaseGate } from "./startupKnowledgeBaseGate";

describe("getStartupKnowledgeBaseGate", () => {
  it("shows loading during bootstrap before settings hydration/external file check completes", () => {
    const result = getStartupKnowledgeBaseGate({
      settingsHydrated: false,
      rootFolderPath: null,
      filesLen: 0,
      isTauri: true,
      lastKnowledgeBasePath: "",
      externalChecked: false,
      isRestoringStartupKnowledgeBase: false,
      hasResolvedStartupKnowledgeBase: false,
    });

    expect(result.shouldShowKnowledgeBaseLoading).toBe(true);
    expect(result.shouldShowKnowledgeBaseOnboarding).toBe(false);
  });

  it("prevents first-render empty knowledge base flicker by showing loading before restore effect sets state", () => {
    const result = getStartupKnowledgeBaseGate({
      settingsHydrated: true,
      rootFolderPath: null,
      filesLen: 0,
      isTauri: true,
      lastKnowledgeBasePath: "/kb",
      externalChecked: true,
      isRestoringStartupKnowledgeBase: false,
      hasResolvedStartupKnowledgeBase: false,
    });

    expect(result.shouldShowKnowledgeBaseLoading).toBe(true);
    expect(result.shouldShowKnowledgeBaseOnboarding).toBe(false);
    expect(result.isStandaloneBootOpen).toBe(false);
  });

  it("shows onboarding only after startup knowledge base has been resolved and there is no root", () => {
    const result = getStartupKnowledgeBaseGate({
      settingsHydrated: true,
      rootFolderPath: null,
      filesLen: 0,
      isTauri: true,
      lastKnowledgeBasePath: "",
      externalChecked: true,
      isRestoringStartupKnowledgeBase: false,
      hasResolvedStartupKnowledgeBase: true,
    });

    expect(result.shouldShowKnowledgeBaseLoading).toBe(false);
    expect(result.shouldShowKnowledgeBaseOnboarding).toBe(true);
  });

  it("does not show loading once a root knowledge base is available", () => {
    const result = getStartupKnowledgeBaseGate({
      settingsHydrated: true,
      rootFolderPath: "/kb",
      filesLen: 10,
      isTauri: true,
      lastKnowledgeBasePath: "/kb",
      externalChecked: true,
      isRestoringStartupKnowledgeBase: true,
      hasResolvedStartupKnowledgeBase: false,
    });

    expect(result.shouldShowKnowledgeBaseLoading).toBe(false);
    expect(result.shouldShowKnowledgeBaseOnboarding).toBe(false);
  });

  it("does not restore vault loading for standalone OS boot openFile", () => {
    const result = getStartupKnowledgeBaseGate({
      settingsHydrated: true,
      rootFolderPath: null,
      filesLen: 0,
      isTauri: true,
      lastKnowledgeBasePath: "/kb",
      externalChecked: true,
      isRestoringStartupKnowledgeBase: false,
      hasResolvedStartupKnowledgeBase: false,
      pendingBootPathCount: 1,
      bootOpenWithVault: false,
    });

    // Still shows a brief file-open loading screen, but not vault restore.
    expect(result.shouldShowKnowledgeBaseLoading).toBe(true);
    expect(result.isStandaloneBootOpen).toBe(true);
  });

  it("still attempts vault restore when in-app new window requests withVault", () => {
    const result = getStartupKnowledgeBaseGate({
      settingsHydrated: true,
      rootFolderPath: null,
      filesLen: 0,
      isTauri: true,
      lastKnowledgeBasePath: "/kb",
      externalChecked: true,
      isRestoringStartupKnowledgeBase: false,
      hasResolvedStartupKnowledgeBase: false,
      pendingBootPathCount: 1,
      bootOpenWithVault: true,
    });

    expect(result.shouldShowKnowledgeBaseLoading).toBe(true);
    expect(result.isStandaloneBootOpen).toBe(false);
  });
});
