export interface CloseTabSafelyOptions {
  tabId: string | null | undefined;
  forceSave: (
    content?: string,
    options?: { trigger?: "auto" | "manual" | "system" },
  ) => Promise<boolean>;
  closeTab: (tabId: string) => void;
  hasUnsavedChanges: (tabId: string) => boolean;
  isTabOpen: (tabId: string) => boolean;
  onBlocked: () => void;
}

/**
 * 关闭当前文档：有未保存内容时先强制保存，失败则拦截关闭。
 */
export async function closeTabSafely(
  options: CloseTabSafelyOptions,
): Promise<boolean> {
  const tabId = options.tabId;
  if (!tabId) return false;

  if (options.hasUnsavedChanges(tabId)) {
    const saved = await options.forceSave(undefined, { trigger: "system" });
    if (!saved) {
      options.onBlocked();
      return false;
    }
  }

  if (options.isTabOpen(tabId)) {
    options.closeTab(tabId);
  }
  return true;
}
