import React from "react";
import { BookOpen } from "lucide-react";
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
      className="workspace-startup ui-scaled min-h-screen flex items-center justify-center p-6"
      style={{ ...uiScaleStyle, fontFamily: uiFontFamily }}
    >
      <div className="workspace-startup-panel w-full max-w-xl p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="workspace-startup-brand w-10 h-10 flex items-center justify-center">
            <BookOpen size={24} aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold">
              {standaloneDocument
                ? t("app_openingDocument")
                : t("app_restoringWorkspace")}
            </h1>
            <p className="workspace-startup-description text-sm">
              {standaloneDocument
                ? t("app_openingDocumentDesc")
                : t("app_restoringWorkspaceDesc")}
            </p>
          </div>
        </div>
        <div className="workspace-startup-status flex items-center gap-3 px-4 py-3">
          <div className="workspace-startup-spinner h-4 w-4 rounded-full border-2 animate-spin" />
          <span className="workspace-startup-description text-sm">
            {standaloneDocument
              ? t("app_openingDocumentStatus")
              : t("app_openingKnowledgeBase")}
          </span>
        </div>
      </div>
    </div>
  );
};
