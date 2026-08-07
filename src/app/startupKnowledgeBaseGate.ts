export function getStartupKnowledgeBaseGate(input: {
  settingsHydrated: boolean;
  rootFolderPath: string | null | undefined;
  filesLen: number;
  isTauri: boolean;
  lastKnowledgeBasePath: string;
  externalChecked: boolean;
  isRestoringStartupKnowledgeBase: boolean;
  hasResolvedStartupKnowledgeBase: boolean;
}): {
  shouldShowKnowledgeBaseLoading: boolean;
  shouldShowKnowledgeBaseOnboarding: boolean;
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
  } = input;

  const hasLastKnowledgeBasePath = Boolean(lastKnowledgeBasePath.trim());

  const shouldShowBootstrapLoading =
    isTauri && !rootFolderPath && (!settingsHydrated || !externalChecked);

  const shouldAttemptStartupRestore =
    settingsHydrated &&
    !rootFolderPath &&
    isTauri &&
    externalChecked &&
    hasLastKnowledgeBasePath;

  // Important: `isRestoringStartupKnowledgeBase` flips to true in an effect.
  // Without this pre-emptive gate, the first render briefly shows the main UI
  // with an "empty knowledge base" placeholder before switching to loading.
  const shouldShowKnowledgeBaseLoading =
    !rootFolderPath &&
    !hasResolvedStartupKnowledgeBase &&
    (shouldShowBootstrapLoading ||
      shouldAttemptStartupRestore ||
      (settingsHydrated && isRestoringStartupKnowledgeBase));

  const shouldShowKnowledgeBaseOnboarding =
    settingsHydrated &&
    !rootFolderPath &&
    filesLen === 0 &&
    hasResolvedStartupKnowledgeBase;

  return { shouldShowKnowledgeBaseLoading, shouldShowKnowledgeBaseOnboarding };
}
