import React from "react";
import { BookOpen } from "lucide-react";
import { useI18n } from "../hooks/useI18n";

export const KnowledgeBaseOnboarding: React.FC<{
  uiScaleStyle: React.CSSProperties;
  uiFontFamily: string;
  onOpen: () => void;
}> = ({ uiScaleStyle, uiFontFamily, onOpen }) => {
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
              {t("app_chooseKnowledgeBase")}
            </h1>
            <p className="workspace-startup-description text-sm">
              {t("app_chooseKnowledgeBaseDesc")}
            </p>
          </div>
        </div>
        <button
          onClick={onOpen}
          className="workspace-startup-open w-full inline-flex items-center justify-center gap-2 px-4 py-3 font-medium"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          {t("app_openKnowledgeBase")}
        </button>
      </div>
    </div>
  );
};
