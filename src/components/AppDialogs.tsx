import React from "react";
import { SettingsModal } from "./settings/SettingsModal";
import { ConfirmDialog, PromptDialog } from "./ui/Dialog";
import { AiResultReviewDialog } from "./ai/AiResultReviewDialog";
import { useAppStore } from "../store/appStore";
import { useI18n } from "../hooks/useI18n";
import { clearDraftBackup } from "../utils/draftBackup";
import { PublishTargetDialog } from "./publish/PublishTargetDialog";
import { SimpleBlogPublishDialog } from "./publish/SimpleBlogPublishDialog";
import { WechatDraftDialog } from "./publish/WechatDraftDialog";
import { ShareLongImageDialog } from "./share/ShareLongImageDialog";
import type { AppSettings, FileNode, Notification } from "../types";
import type {
  WechatDraftDefaults,
  WechatDraftPublishInput,
} from "../utils/wechatPublish";
import type {
  SimpleBlogPublishDefaults,
  SimpleBlogPublishInput,
} from "../utils/simpleBlogPublish";
import type { LongImageSharePayload } from "./share/longImageSharePayload";

interface AppDialogsProps {
  isSettingsOpen: boolean;
  isNewNoteDialogOpen: boolean;
  isPublishTargetDialogOpen: boolean;
  isSimpleBlogDialogOpen: boolean;
  isWechatDraftDialogOpen: boolean;
  isShareLongImageDialogOpen: boolean;
  isPublishing: boolean;
  settings: AppSettings;
  wechatDraftDefaults: WechatDraftDefaults | null;
  simpleBlogPublishDefaults: SimpleBlogPublishDefaults | null;
  notification: Notification | null;
  attachmentContext: { files: FileNode[]; rootFolderPath: string | null };
  t: (key: string) => string;
  uiScaleStyle: React.CSSProperties;
  buildPayload: () => Promise<LongImageSharePayload | null>;
  onCloseSettings: () => void;
  onUpdateSettings: (s: Partial<AppSettings>) => void;
  onCloseNewNote: () => void;
  onSubmitNewNote: (value: string) => void;
  onClosePublishTarget: () => void;
  onSelectSimpleBlog: () => void;
  onSelectWechatDraft: () => void;
  onCloseSimpleBlog: () => void;
  onSubmitSimpleBlog: (input: SimpleBlogPublishInput) => void;
  onCloseWechatDraft: () => void;
  onSubmitWechatDraft: (input: WechatDraftPublishInput) => void;
  onCloseShareLongImage: () => void;
  isAiEnhanceConfirmOpen?: boolean;
  onConfirmAiEnhance?: () => void;
  onCancelAiEnhance?: () => void;
  cleanupPendingCount?: number;
  onConfirmCleanupAttachments?: () => void;
  onCancelCleanupAttachments?: () => void;
}

export const AppDialogs: React.FC<AppDialogsProps> = ({
  isSettingsOpen,
  isNewNoteDialogOpen,
  isPublishTargetDialogOpen,
  isSimpleBlogDialogOpen,
  isWechatDraftDialogOpen,
  isShareLongImageDialogOpen,
  isPublishing,
  settings,
  wechatDraftDefaults,
  simpleBlogPublishDefaults,
  notification,
  attachmentContext,
  t,
  uiScaleStyle,
  buildPayload,
  onCloseSettings,
  onUpdateSettings,
  onCloseNewNote,
  onSubmitNewNote,
  onClosePublishTarget,
  onSelectSimpleBlog,
  onSelectWechatDraft,
  onCloseSimpleBlog,
  onSubmitSimpleBlog,
  onCloseWechatDraft,
  onSubmitWechatDraft,
  onCloseShareLongImage,
  isAiEnhanceConfirmOpen = false,
  onConfirmAiEnhance,
  onCancelAiEnhance,
  cleanupPendingCount = 0,
  onConfirmCleanupAttachments,
  onCancelCleanupAttachments,
}) => {
  const { t: tr } = useI18n();
  const pendingDraftRestore = useAppStore((state) => state.pendingDraftRestore);
  const setPendingDraftRestore = useAppStore(
    (state) => state.setPendingDraftRestore,
  );
  const setContentForFile = useAppStore((state) => state.setContentForFile);

  const handleRestoreDraft = () => {
    if (!pendingDraftRestore) return;
    setContentForFile(
      pendingDraftRestore.fileId,
      pendingDraftRestore.draftContent,
    );
    clearDraftBackup(pendingDraftRestore.fileId);
    setPendingDraftRestore(null);
  };

  const handleDiscardDraft = () => {
    if (!pendingDraftRestore) return;
    clearDraftBackup(pendingDraftRestore.fileId);
    setPendingDraftRestore(null);
  };

  return (
    <>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={onCloseSettings}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        uiScaleStyle={uiScaleStyle}
      />

      <PromptDialog
        isOpen={isNewNoteDialogOpen}
        onClose={onCloseNewNote}
        onSubmit={onSubmitNewNote}
        title={t("app_newFile")}
        label={t("app_fileName")}
        defaultValue={t("app_untitled")}
        submitText={t("common_create")}
      />

      <PublishTargetDialog
        isOpen={isPublishTargetDialogOpen}
        onClose={onClosePublishTarget}
        onSelectSimpleBlog={onSelectSimpleBlog}
        onSelectWechatDraft={onSelectWechatDraft}
      />

      <SimpleBlogPublishDialog
        isOpen={isSimpleBlogDialogOpen}
        isSubmitting={isPublishing}
        defaults={simpleBlogPublishDefaults}
        onClose={onCloseSimpleBlog}
        onSubmit={(input) => {
          void onSubmitSimpleBlog(input);
        }}
      />

      <WechatDraftDialog
        isOpen={isWechatDraftDialogOpen}
        isSubmitting={isPublishing}
        defaults={wechatDraftDefaults}
        onClose={onCloseWechatDraft}
        onSubmit={(input) => {
          void onSubmitWechatDraft(input);
        }}
      />

      <ShareLongImageDialog
        isOpen={isShareLongImageDialogOpen}
        onClose={onCloseShareLongImage}
        buildPayload={buildPayload}
        attachmentContext={attachmentContext}
      />

      <AiResultReviewDialog />

      <ConfirmDialog
        isOpen={pendingDraftRestore !== null}
        onClose={handleDiscardDraft}
        onConfirm={handleRestoreDraft}
        title={tr("draft_restoreTitle")}
        message={tr("draft_restoreMessage", {
          name: pendingDraftRestore?.fileName ?? "",
        })}
        confirmText={tr("draft_restoreConfirm")}
        cancelText={tr("draft_restoreDiscard")}
        variant="warning"
      />

      <ConfirmDialog
        isOpen={isAiEnhanceConfirmOpen}
        onClose={() => onCancelAiEnhance?.()}
        onConfirm={() => onConfirmAiEnhance?.()}
        title={tr("ai_confirmTitle")}
        message={tr("ai_confirmMessage")}
        confirmText={tr("ai_confirmRun")}
        variant="warning"
      />

      <ConfirmDialog
        isOpen={cleanupPendingCount > 0}
        onClose={() => onCancelCleanupAttachments?.()}
        onConfirm={() => onConfirmCleanupAttachments?.()}
        title={tr("sidebar_cleanupUnusedAttachmentsTitle")}
        message={tr("sidebar_cleanupUnusedAttachmentsConfirm", {
          count: cleanupPendingCount,
        })}
        confirmText={tr("sidebar_cleanupUnusedAttachments")}
        variant="danger"
      />

      {notification && (
        <div
          className={`ui-scaled fixed top-6 right-6 px-4 py-3 rounded-xl shadow-xl z-[250] animate-fade-in border glass ${
            notification.type === "success"
              ? "text-green-600 border-green-100 dark:border-green-900"
              : notification.type === "info"
                ? "text-blue-600 border-blue-100 dark:text-blue-400 dark:border-blue-900"
                : notification.type === "warning"
                  ? "text-amber-600 border-amber-100 dark:text-amber-400 dark:border-amber-900"
                  : "text-red-500 border-red-100 dark:border-red-900"
          }`}
          role="status"
          aria-live="polite"
        >
          {notification.msg}
        </div>
      )}
    </>
  );
};
