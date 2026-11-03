import React from "react";
import { ChevronDown, Folder, Settings } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

export interface KnowledgeBaseHeaderProps {
  name?: string;
  path?: string;
  disabled?: boolean;
  onSwitch: () => void;
  onOpenSettings: () => void;
}

export const KnowledgeBaseHeader: React.FC<KnowledgeBaseHeaderProps> = ({
  name,
  path,
  disabled = false,
  onSwitch,
  onOpenSettings,
}) => {
  const { t } = useI18n();
  const label = name || t("app_openKnowledgeBase");

  return (
    <div className="workspace-vault-row">
      <button
        type="button"
        onClick={onSwitch}
        disabled={disabled}
        aria-disabled={disabled}
        className="workspace-vault-switch"
        title={
          disabled
            ? t("sidebar_openKnowledgeBaseDisabledStandalone")
            : path || t("app_openKnowledgeBase")
        }
      >
        <Folder size={16} className="shrink-0" aria-hidden />
        <p className="text-sm font-semibold truncate min-w-0">{label}</p>
        <ChevronDown size={13} className="shrink-0 opacity-60" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        className="workspace-settings-button"
        title={t("settings_openSettings")}
        aria-label={t("settings_openSettings")}
      >
        <Settings size={16} aria-hidden />
      </button>
    </div>
  );
};
