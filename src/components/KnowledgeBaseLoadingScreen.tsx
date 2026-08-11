import React from "react";
import { useI18n } from "../hooks/useI18n";

export const KnowledgeBaseLoadingScreen: React.FC<{
  uiScaleStyle: React.CSSProperties;
  uiFontFamily: string;
  /** Standalone OS file launch — do not mention restoring a knowledge base. */
  standaloneDocument?: boolean;
}> = ({ uiScaleStyle, uiFontFamily, standaloneDocument = false }) => {
  const { t } = useI18n();

  return (
    <div
      className="ui-scaled min-h-screen bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100 flex items-center justify-center p-6"
      style={{ ...uiScaleStyle, fontFamily: uiFontFamily }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-gray-200/70 dark:border-white/10 bg-white/90 dark:bg-gray-900/80 backdrop-blur-md shadow-xl p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center font-bold tracking-tight">
            M
          </div>
          <div>
            <h1 className="text-xl font-semibold">
              {standaloneDocument
                ? t("app_openingDocument")
                : t("app_restoringWorkspace")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {standaloneDocument
                ? t("app_openingDocumentDesc")
                : t("app_restoringWorkspaceDesc")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200/70 dark:border-white/10 bg-gray-50/80 dark:bg-black/30 px-4 py-3">
          <div className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-black dark:border-gray-700 dark:border-t-white animate-spin" />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {standaloneDocument
              ? t("app_openingDocumentStatus")
              : t("app_openingKnowledgeBase")}
          </span>
        </div>
      </div>
    </div>
  );
};
