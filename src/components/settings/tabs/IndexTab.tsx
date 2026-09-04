import React, { useEffect, useMemo, useState } from "react";
import type { AppSettings, EmbeddingProviderId } from "../../../types";
import { useAppStore } from "../../../store/appStore";
import { useI18n } from "../../../hooks/useI18n";
import { requestVaultLinkIndexRebuild } from "../../../services/vault/linkIndexEvents";
import {
  BUILTIN_EMBEDDING_MODEL,
  ensureBuiltinEmbeddingReady,
  getBuiltinEmbeddingStatus,
  resetBuiltinEmbeddingPipeline,
  subscribeBuiltinEmbeddingStatus,
  type BuiltinEmbeddingHub,
  type BuiltinEmbeddingStatus,
} from "../../../services/vault/builtinEmbedding";
import { useSecureSettings } from "../useSecureSettings";
import { AppSelect } from "../../ui/AppSelect";
import {
  DEFAULT_INDEX_EXCLUDE_GLOBS,
  parseExcludeGlobText,
} from "../../../utils/pathGlob";

interface IndexTabProps {
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
}

export const IndexTab: React.FC<IndexTabProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useI18n();
  const progress = useAppStore((s) => s.linkIndexProgress);
  const linkIndex = useAppStore((s) => s.linkIndex);
  const chunkIndex = useAppStore((s) => s.chunkIndex);
  const semanticReady = useAppStore((s) => s.semanticReady);
  const semanticVectorCount = useAppStore((s) => s.semanticVectorCount);
  const rootFolderPath = useAppStore((s) => s.rootFolderPath);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [builtinStatus, setBuiltinStatus] = useState<BuiltinEmbeddingStatus>(
    () => getBuiltinEmbeddingStatus(),
  );
  const { handleSecureSettingChange, renderSecureSaveState } =
    useSecureSettings(onUpdateSettings);

  useEffect(() => {
    return subscribeBuiltinEmbeddingStatus(setBuiltinStatus);
  }, []);

  const noteCount = linkIndex ? Object.keys(linkIndex.outbounds).length : 0;
  const chunkCount = useMemo(
    () =>
      chunkIndex
        ? Object.values(chunkIndex.byPath).reduce(
            (sum, chunks) => sum + chunks.length,
            0,
          )
        : 0,
    [chunkIndex],
  );
  const isWorking =
    busy || progress.phase === "building" || progress.phase === "updating";

  const handleRebuild = async () => {
    if (!rootFolderPath) {
      setMessage(t("index_noVault"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await requestVaultLinkIndexRebuild();
      setMessage(t("index_rebuildDone"));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("index_rebuildFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const builtAtLabel = progress.builtAt
    ? new Date(progress.builtAt).toLocaleString()
    : t("index_neverBuilt");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("index_title")}
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("index_desc")}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200/70 dark:border-white/10 p-4 space-y-2 text-sm text-gray-600 dark:text-gray-300">
        <div className="flex justify-between gap-3">
          <span>{t("index_status")}</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {progress.phase === "building"
              ? t("index_statusBuilding", {
                  done: progress.done,
                  total: Math.max(progress.total, 1),
                })
              : progress.phase === "updating"
                ? t("index_statusUpdating")
                : progress.phase === "error"
                  ? t("index_statusError")
                  : t("index_statusReady")}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>{t("index_notesIndexed")}</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {noteCount}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>{t("index_chunksIndexed")}</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {chunkCount}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>{t("index_vectors")}</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {semanticReady
              ? t("index_vectorsReady", { count: semanticVectorCount })
              : t("index_vectorsOff")}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>{t("index_lastBuilt")}</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {builtAtLabel}
          </span>
        </div>
        {progress.error ? (
          <p className="text-rose-500 text-xs pt-1">{progress.error}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("index_excludeTitle")}
        </h4>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("index_excludeDesc")}
        </p>
        <textarea
          className="mt-1 w-full min-h-[6rem] rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs dark:border-white/10 dark:bg-black/20"
          value={(
            settings.indexExcludeGlobs ?? DEFAULT_INDEX_EXCLUDE_GLOBS
          ).join("\n")}
          onChange={(event) =>
            onUpdateSettings({
              indexExcludeGlobs: parseExcludeGlobText(event.target.value),
            })
          }
          spellCheck={false}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("index_excludeHint")}
        </p>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("index_embeddingTitle")}
        </h4>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("index_embeddingDesc")}
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600 dark:text-gray-300">
            {t("index_embeddingProvider")}
          </span>
          <AppSelect
            aria-label={t("index_embeddingProvider")}
            value={settings.embeddingProvider ?? "builtin"}
            options={[
              { value: "builtin", label: t("index_embeddingBuiltin") },
              { value: "none", label: t("index_embeddingNone") },
              {
                value: "openai-compatible",
                label: t("index_embeddingOpenAICompatible"),
              },
            ]}
            onChange={(embeddingProvider) =>
              onUpdateSettings({
                embeddingProvider: embeddingProvider as EmbeddingProviderId,
              })
            }
          />
        </label>

        {(settings.embeddingProvider ?? "builtin") === "builtin" ? (
          <div className="rounded-xl border border-gray-200/70 dark:border-white/10 p-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3 text-gray-600 dark:text-gray-300">
              <span>{t("index_embeddingBuiltinModel")}</span>
              <span className="font-medium text-gray-900 dark:text-white text-right break-all">
                {BUILTIN_EMBEDDING_MODEL}
              </span>
            </div>
            <div className="flex justify-between gap-3 text-gray-600 dark:text-gray-300">
              <span>{t("index_embeddingBuiltinStatus")}</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {builtinStatus.phase === "ready"
                  ? t("index_embeddingBuiltinReady")
                  : builtinStatus.phase === "loading"
                    ? t("index_embeddingBuiltinLoading", {
                        percent: Math.round(builtinStatus.progress * 100),
                      })
                    : builtinStatus.phase === "error"
                      ? t("index_embeddingBuiltinError")
                      : t("index_embeddingBuiltinIdle")}
              </span>
            </div>
            {builtinStatus.hub ? (
              <div className="flex justify-between gap-3 text-gray-600 dark:text-gray-300">
                <span>{t("index_embeddingHubActive")}</span>
                <span className="font-medium text-gray-900 dark:text-white text-right break-all">
                  {builtinStatus.hub}
                </span>
              </div>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600 dark:text-gray-300">
                {t("index_embeddingHub")}
              </span>
              <AppSelect
                aria-label={t("index_embeddingHub")}
                value={settings.embeddingHub ?? "auto"}
                options={[
                  { value: "auto", label: t("index_embeddingHubAuto") },
                  {
                    value: "huggingface",
                    label: t("index_embeddingHubHuggingFace"),
                  },
                  {
                    value: "hf-mirror",
                    label: t("index_embeddingHubMirror"),
                  },
                ]}
                onChange={(embeddingHub) => {
                  resetBuiltinEmbeddingPipeline();
                  onUpdateSettings({
                    embeddingHub: embeddingHub as BuiltinEmbeddingHub,
                  });
                }}
              />
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("index_embeddingHubHint")}
            </p>
            {builtinStatus.phase === "loading" ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
                <div
                  className="h-full bg-sky-500 transition-[width]"
                  style={{
                    width: `${Math.max(4, Math.round(builtinStatus.progress * 100))}%`,
                  }}
                />
              </div>
            ) : null}
            {builtinStatus.error ? (
              <p className="text-rose-500 text-xs">{builtinStatus.error}</p>
            ) : null}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("index_embeddingBuiltinHint")}
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600 dark:text-gray-300">
                {t("index_embeddingConsentLabel")}
              </span>
              <AppSelect
                aria-label={t("index_embeddingConsentLabel")}
                value={settings.builtinEmbeddingDownloadConsent ?? "unknown"}
                options={[
                  {
                    value: "unknown",
                    label: t("index_embeddingConsentUnknown"),
                  },
                  {
                    value: "granted",
                    label: t("index_embeddingConsentGranted"),
                  },
                  {
                    value: "denied",
                    label: t("index_embeddingConsentDenied"),
                  },
                ]}
                onChange={(consent) =>
                  onUpdateSettings({
                    builtinEmbeddingDownloadConsent:
                      consent as typeof settings.builtinEmbeddingDownloadConsent,
                  })
                }
              />
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("index_embeddingConsentHint")}
            </p>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  builtinEmbeddingDownloadConsent: "unknown",
                })
              }
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-black/[0.03] dark:hover:bg-white/10"
            >
              {t("index_embeddingConsentReset")}
            </button>
            <button
              type="button"
              disabled={builtinStatus.phase === "loading"}
              onClick={() => {
                const hub = settings.embeddingHub ?? "auto";
                onUpdateSettings({
                  builtinEmbeddingDownloadConsent: "granted",
                });
                // Reload / retry must drop the cached pipeline first.
                if (
                  builtinStatus.phase === "ready" ||
                  builtinStatus.phase === "error"
                ) {
                  resetBuiltinEmbeddingPipeline();
                }
                void ensureBuiltinEmbeddingReady(hub)
                  .then(() => setMessage(t("index_embeddingBuiltinReady")))
                  .catch((error) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : t("index_embeddingBuiltinError"),
                    ),
                  );
              }}
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-black/[0.03] dark:hover:bg-white/10 disabled:opacity-50"
            >
              {builtinStatus.phase === "ready"
                ? t("index_embeddingBuiltinReload")
                : t("index_embeddingBuiltinDownload")}
            </button>
          </div>
        ) : null}

        {(settings.embeddingProvider ?? "none") === "openai-compatible" ? (
          <>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-300">
                {t("index_embeddingBaseUrl")}
              </span>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2"
                value={settings.embeddingApiBaseUrl ?? ""}
                onChange={(event) =>
                  onUpdateSettings({ embeddingApiBaseUrl: event.target.value })
                }
                placeholder="http://127.0.0.1:11434/v1"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-300">
                {t("index_embeddingModel")}
              </span>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2"
                value={settings.embeddingModel ?? ""}
                onChange={(event) =>
                  onUpdateSettings({ embeddingModel: event.target.value })
                }
                placeholder="nomic-embed-text"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-300">
                {t("index_embeddingApiKey")}
              </span>
              <input
                type="password"
                className="mt-1 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2"
                value={settings.embeddingApiKey ?? ""}
                onChange={(event) =>
                  handleSecureSettingChange(
                    "embeddingApiKey",
                    event.target.value,
                  )
                }
                placeholder="ollama"
              />
              {renderSecureSaveState("embeddingApiKey")}
            </label>
          </>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1 block text-gray-600 dark:text-gray-300">
            {t("index_searchModeDefault")}
          </span>
          <AppSelect
            aria-label={t("index_searchModeDefault")}
            value={settings.searchModeDefault ?? "keyword"}
            options={[
              { value: "keyword", label: t("search_mode_keyword") },
              { value: "semantic", label: t("search_mode_semantic") },
              { value: "hybrid", label: t("search_mode_hybrid") },
            ]}
            onChange={(searchModeDefault) =>
              onUpdateSettings({
                searchModeDefault:
                  searchModeDefault as AppSettings["searchModeDefault"],
              })
            }
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={settings.privacyMode === true}
            onChange={(event) =>
              onUpdateSettings({ privacyMode: event.target.checked })
            }
          />
          {t("index_privacyMode")}
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("index_privacyModeDesc")}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void handleRebuild()}
        disabled={isWorking || !rootFolderPath}
        className="inline-flex items-center justify-center rounded-xl bg-black dark:bg-white text-white dark:text-black px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {isWorking ? t("index_rebuilding") : t("index_rebuild")}
      </button>

      {message ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      ) : null}
    </div>
  );
};
