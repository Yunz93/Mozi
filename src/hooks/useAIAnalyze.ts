import { useCallback, useState } from "react";
import { useAppStore, selectContent } from "../store/appStore";
import { useFileSystem } from "./useFileSystem";
import { isExcalidrawWorkspaceFile } from "../utils/excalidrawDocument";
import { isPreviewOnlyFile } from "../utils/fileTypes";
import {
  analyzeMarkdownWithProvider,
  ensureAIConfiguration,
  generateWikiFromSelectionWithProvider,
} from "../services/aiService";
import { hydrateSensitiveSettingsIntoStore } from "../services/secureSettingsService";
import { generateFrontmatter, parseFrontmatter } from "../utils/frontmatter";
import { parseMetadataTemplateValue } from "../utils/metadataFields";
import { type AppLanguage, type Frontmatter } from "../types";
import { getFileSystem } from "../types/filesystem";
import { joinFsPath } from "../utils/pathHelpers";
import {
  buildWikiBacklink,
  buildWikiSupplementSections,
  normalizeWikiFolder,
  sanitizeWikiArchiveSegment,
  stripDuplicateWikiSupplementSections,
} from "../utils/wikiGeneration";
import { localizeKnownError, t } from "../utils/i18n";

function getFrontmatterBlockLength(content: string): number {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? match[0].length : 0;
}

function getFileNameFromPath(path: string | null): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

/** True when the current note can run full-document AI enhance. */
export function canRequestAiEnhance(options: {
  isAnalyzing: boolean;
  activeTabId: string | null;
  currentFilePath: string | null;
  content: string;
}): boolean {
  if (options.isAnalyzing) return false;
  if (!options.activeTabId || !options.content) return false;
  const fileName = getFileNameFromPath(options.currentFilePath);
  if (!fileName) return false;
  if (isPreviewOnlyFile(fileName)) return false;
  if (isExcalidrawWorkspaceFile(fileName, options.content)) return false;
  return true;
}

function stripMarkdownExtension(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, "");
}

function sanitizeWikiFileName(input: string): string {
  const sanitized = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  return sanitized || "Untitled Wiki";
}

function sanitizeWikiLinkAlias(input: string): string {
  return input
    .replace(/\]\]/g, "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function buildContextSnippet(
  content: string,
  from: number,
  to: number,
  radius: number = 800,
) {
  const safeFrom = Math.max(0, from);
  const safeTo = Math.min(content.length, to);
  return {
    before: content.slice(Math.max(0, safeFrom - radius), safeFrom).trim(),
    after: content
      .slice(safeTo, Math.min(content.length, safeTo + radius))
      .trim(),
  };
}

function extractDocumentTitle(
  content: string,
  fallbackPath: string | null,
): string {
  const { frontmatter, body } = parseFrontmatter(content);

  if (typeof frontmatter?.title === "string" && frontmatter.title.trim()) {
    return frontmatter.title.trim();
  }

  const headingLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#\s+/.test(line));

  if (headingLine) {
    return headingLine.replace(/^#\s+/, "").trim();
  }

  return stripMarkdownExtension(getFileNameFromPath(fallbackPath));
}

async function resolveUniqueWikiFileName(
  baseName: string,
  folderPath: string,
): Promise<string> {
  const fs = await getFileSystem();
  const normalizedBase = sanitizeWikiFileName(baseName);

  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : ` ${index + 1}`;
    const candidate = `${normalizedBase}${suffix}.md`;
    const separator = folderPath.includes("\\") ? "\\" : "/";
    const fullPath = `${folderPath}${folderPath.endsWith(separator) ? "" : separator}${candidate}`;

    if (!(await fs.fileExists(fullPath))) {
      return candidate;
    }
  }

  return `${normalizedBase} ${Date.now()}.md`;
}

function ensureHeading(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return `# ${title}\n\n`;
  }

  if (/^#\s+/.test(trimmed)) {
    return `${trimmed}\n`;
  }

  return `# ${title}\n\n${trimmed}\n`;
}

function buildGeneratedWikiContent(options: {
  language: AppLanguage;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  selectedText: string;
  markdown: string;
  sourceWikiTarget: string;
  metadataFields: { key: string; defaultValue: string }[];
  references: { title: string; url?: string; note?: string }[];
  citations: string[];
}) {
  const frontmatter: Frontmatter = {};

  options.metadataFields.forEach((field) => {
    frontmatter[field.key] = parseMetadataTemplateValue(field.defaultValue);
  });

  frontmatter.title = options.title;
  frontmatter.description = options.summary;
  frontmatter.category = options.category;
  frontmatter.tags = options.tags;
  if (
    options.selectedText.trim() &&
    options.selectedText.trim() !== options.title.trim()
  ) {
    frontmatter.aliases = [sanitizeWikiLinkAlias(options.selectedText)];
  }

  const backlink = buildWikiBacklink(
    options.language,
    options.sourceWikiTarget,
  );
  const supplementSections = buildWikiSupplementSections(
    options.language,
    options.references,
    options.citations,
  );

  const normalizedMarkdown = stripDuplicateWikiSupplementSections(
    ensureHeading(options.markdown, options.title).trimEnd(),
  );

  return `${generateFrontmatter(frontmatter)}${normalizedMarkdown}${backlink}${supplementSections}`;
}

function getDefaultWikiCategory(language: AppLanguage): string {
  return language === "en" ? "Uncategorized" : "未分类";
}

/**
 * Encapsulates AI-powered content analysis and selection-based wiki generation.
 */
export function useAIAnalyze() {
  const {
    activeTabId,
    setAnalyzing,
    showNotification,
    setSettingsOpen,
    currentFilePath,
    rootFolderPath,
    isAnalyzing,
  } = useAppStore();
  const content = useAppStore(selectContent);
  const { createFile, refreshFileTree } = useFileSystem();
  const [isAiEnhanceConfirmOpen, setAiEnhanceConfirmOpen] = useState(false);

  const requestAIAnalyze = useCallback(() => {
    const state = useAppStore.getState();
    if (
      !canRequestAiEnhance({
        isAnalyzing: state.isAnalyzing,
        activeTabId: state.activeTabId,
        currentFilePath: state.currentFilePath,
        content: selectContent(state),
      })
    ) {
      return;
    }
    setAiEnhanceConfirmOpen(true);
  }, []);

  const closeAiEnhanceConfirm = useCallback(() => {
    setAiEnhanceConfirmOpen(false);
  }, []);

  const handleAIAnalyze = useCallback(async () => {
    if (isAnalyzing) return;
    if (!content || !activeTabId) return;
    const hydratedSettings = await hydrateSensitiveSettingsIntoStore();

    try {
      ensureAIConfiguration(hydratedSettings);
    } catch (error) {
      showNotification(
        error instanceof Error
          ? localizeKnownError(hydratedSettings.language, error.message)
          : t(hydratedSettings.language, "notifications_aiConfigFirst"),
        "error",
      );
      setSettingsOpen(true);
      return;
    }

    setAnalyzing(true);
    try {
      const { frontmatter: existingFrontmatter, body } =
        parseFrontmatter(content);
      const result = await analyzeMarkdownWithProvider(body, hydratedSettings);
      const today = new Date().toISOString().split("T")[0];

      const aiFields: Partial<Frontmatter> = {
        title: result.seoTitle,
        date: today,
        description: result.summary,
        tags: result.suggestedTags,
      };

      const mergedFrontmatter: Frontmatter = {
        ...existingFrontmatter,
        ...aiFields,
        ...(existingFrontmatter?.category !== undefined && {
          category: existingFrontmatter.category,
        }),
        ...(existingFrontmatter?.status !== undefined && {
          status: existingFrontmatter.status,
        }),
        ...(existingFrontmatter?.is_publish !== undefined && {
          is_publish: existingFrontmatter.is_publish,
        }),
        ...(existingFrontmatter?.layout !== undefined && {
          layout: existingFrontmatter.layout,
        }),
      };

      const frontmatterBlock = generateFrontmatter(mergedFrontmatter);
      const optimizedBody = (result.optimizedMarkdown || body).trim();
      const newContent = `${frontmatterBlock}${optimizedBody}\n`;

      // Never overwrite the note silently: stage the result and let the user
      // review it in a dialog before applying.
      useAppStore.getState().setPendingAiResult({
        fileId: activeTabId,
        previousContent: content,
        newContent,
      });
    } catch (error) {
      console.error("AI analysis failed:", error);
      showNotification(
        error instanceof Error
          ? localizeKnownError(hydratedSettings.language, error.message)
          : t(hydratedSettings.language, "notifications_aiEnhanceFailed"),
        "error",
      );
    } finally {
      setAnalyzing(false);
    }
  }, [
    activeTabId,
    content,
    isAnalyzing,
    setAnalyzing,
    showNotification,
    setSettingsOpen,
  ]);

  const handleGenerateWikiFromSelection = useCallback(
    async (selection: {
      text: string;
      from: number;
      to: number;
    }): Promise<string | null> => {
      if (!content) return null;

      const selectedText = sanitizeWikiLinkAlias(selection.text);
      if (!selectedText) {
        return null;
      }
      const hydratedSettings = await hydrateSensitiveSettingsIntoStore();

      try {
        ensureAIConfiguration(hydratedSettings);
      } catch (error) {
        showNotification(
          error instanceof Error
            ? localizeKnownError(hydratedSettings.language, error.message)
            : t(hydratedSettings.language, "notifications_aiConfigFirst"),
          "error",
        );
        setSettingsOpen(true);
        return null;
      }

      if (!rootFolderPath) {
        showNotification(
          t(hydratedSettings.language, "notifications_noKnowledgeBaseForWiki"),
          "error",
        );
        return null;
      }

      setAnalyzing(true);
      try {
        const documentTitle = extractDocumentTitle(content, currentFilePath);
        const currentFileName = stripMarkdownExtension(
          getFileNameFromPath(currentFilePath),
        );
        const sourceWikiTarget = currentFileName || documentTitle;
        const context = buildContextSnippet(
          content,
          selection.from,
          selection.to,
        );
        const result = await generateWikiFromSelectionWithProvider(
          {
            selectedText,
            contextBefore: context.before,
            contextAfter: context.after,
            documentTitle,
            currentFileName,
            isFrontmatterSelection:
              selection.to <= getFrontmatterBlockLength(content),
          },
          hydratedSettings,
        );

        const wikiFolder = normalizeWikiFolder(hydratedSettings.wikiFolder);
        const archiveCategory = sanitizeWikiArchiveSegment(
          result.category,
          getDefaultWikiCategory(hydratedSettings.language),
        );
        const targetFolder = joinFsPath(
          rootFolderPath,
          wikiFolder,
          archiveCategory,
        );
        const fs = await getFileSystem();
        await fs.createDirectory(targetFolder);
        await refreshFileTree();

        const targetFileName = await resolveUniqueWikiFileName(
          result.title || selectedText,
          targetFolder,
        );
        const wikiTarget = `${wikiFolder}/${archiveCategory}/${stripMarkdownExtension(targetFileName)}`;
        const nextFileContent = buildGeneratedWikiContent({
          language: hydratedSettings.language,
          title: result.title || selectedText,
          summary: result.summary || "",
          category: archiveCategory,
          tags: result.suggestedTags || [],
          selectedText,
          markdown: result.markdown || "",
          sourceWikiTarget,
          metadataFields: hydratedSettings.metadataFields,
          references: result.references || [],
          citations: result.citations || [],
        });

        const newFile = await createFile(
          targetFileName,
          nextFileContent,
          targetFolder,
        );
        if (!newFile) {
          throw new Error("Failed to create the wiki file.");
        }

        showNotification(
          t(hydratedSettings.language, "notifications_wikiCreated", {
            name: newFile.name,
          }),
          "success",
        );
        return `[[${wikiTarget}|${selectedText}]]`;
      } catch (error) {
        console.error("AI wiki generation failed:", error);
        showNotification(
          error instanceof Error
            ? localizeKnownError(hydratedSettings.language, error.message)
            : t(hydratedSettings.language, "notifications_wikiCreateFailed"),
          "error",
        );
        return null;
      } finally {
        setAnalyzing(false);
      }
    },
    [
      content,
      currentFilePath,
      rootFolderPath,
      setAnalyzing,
      showNotification,
      setSettingsOpen,
      createFile,
      refreshFileTree,
    ],
  );

  return {
    handleAIAnalyze,
    requestAIAnalyze,
    closeAiEnhanceConfirm,
    isAiEnhanceConfirmOpen,
    handleGenerateWikiFromSelection,
  };
}
