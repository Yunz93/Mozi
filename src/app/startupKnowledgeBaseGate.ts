import { shouldRestoreVaultOnBoot } from "../utils/bootOpenFile";

export function getStartupKnowledgeBaseGate(input: {
  settingsHydrated: boolean;
  rootFolderPath: string | null | undefined;
  filesLen: number;
  isTauri: boolean;
  lastKnowledgeBasePath: string;
  externalChecked: boolean;
  isRestoringStartupKnowledgeBase: boolean;
  hasResolvedStartupKnowledgeBase: boolean;
  /** Boot `?openFile=` / `take_opened_files` count. */
  pendingBootPathCount?: number;
  /** In-app new window sets true; OS launches leave false. */
  bootOpenWithVault?: boolean;
}): {
  shouldShowKnowledgeBaseLoading: boolean;
  shouldShowKnowledgeBaseOnboarding: boolean;
  /** Standalone OS file open (loading message should not mention the vault). */
  isStandaloneBootOpen: boolean;
} {
  const {
    settingsHydrated,
    rootFolderPath,
    filesLen,
    isTauri,
    lastKnowledgeBasePath,
    externalChecked,
    isRestoringStartupKnowledgeBase,
    hasResolvedStartupKnowledgeBase,
    pendingBootPathCount = 0,
    bootOpenWithVault = false,
  } = input;

  const hasLastKnowledgeBasePath = Boolean(lastKnowledgeBasePath.trim());
  const restoreVaultOnBoot = shouldRestoreVaultOnBoot({
    pendingBootPathCount,
    withVault: bootOpenWithVault,
  });
  const isStandaloneBootOpen = pendingBootPathCount > 0 && !bootOpenWithVault;

  const shouldShowBootstrapLoading =
    isTauri && !rootFolderPath && (!settingsHydrated || !externalChecked);

  const shouldAttemptStartupRestore =
    settingsHydrated &&
    !rootFolderPath &&
    isTauri &&
    externalChecked &&
    hasLastKnowledgeBasePath &&
    restoreVaultOnBoot;

  const shouldShowStandaloneFileLoading =
    settingsHydrated &&
    !rootFolderPath &&
    isTauri &&
    externalChecked &&
    isStandaloneBootOpen &&
    !hasResolvedStartupKnowledgeBase;

  // Important: `isRestoringStartupKnowledgeBase` flips to true in an effect.
  // Without this pre-emptive gate, the first render briefly shows the main UI
  // with an "empty knowledge base" placeholder before switching to loading.
  const shouldShowKnowledgeBaseLoading =
    !rootFolderPath &&
    !hasResolvedStartupKnowledgeBase &&
    (shouldShowBootstrapLoading ||
      shouldAttemptStartupRestore ||
      shouldShowStandaloneFileLoading ||
      (settingsHydrated && isRestoringStartupKnowledgeBase));

  const shouldShowKnowledgeBaseOnboarding =
    settingsHydrated &&
    !rootFolderPath &&
    filesLen === 0 &&
    hasResolvedStartupKnowledgeBase;

  return {
    shouldShowKnowledgeBaseLoading,
    shouldShowKnowledgeBaseOnboarding,
    isStandaloneBootOpen,
  };
}
