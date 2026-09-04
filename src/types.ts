export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
  path: string;
  isPublished?: boolean;
  isTrash?: boolean;
}

export interface Frontmatter {
  title?: string;
  date?: string;
  tags?: string[];
  description?: string;
  layout?: string;
  slug?: string;
  aliases?: string | string[];
  link?: string;
  [key: string]: string | string[] | number | boolean | null | undefined;
}

export interface ParsedMarkdown {
  frontmatter: Frontmatter | null;
  body: string;
}

export interface MarkdownFile {
  frontmatter: Frontmatter;
  body: string;
  raw: string;
}

export enum ViewMode {
  EDITOR = "EDITOR",
  LIVE = "LIVE",
  PREVIEW = "PREVIEW",
  SPLIT = "SPLIT",
}

export interface AIAnalysisResult {
  summary: string;
  suggestedTags: string[];
  seoTitle: string;
  optimizedMarkdown: string;
}

export interface AIWikiReference {
  title: string;
  url?: string;
  note?: string;
}

export interface AIWikiGenerationResult {
  title: string;
  summary: string;
  category: string;
  suggestedTags: string[];
  markdown: string;
  references: AIWikiReference[];
  citations: string[];
}

export type AIProvider = "gemini" | "codex" | "deepseek";

export interface ShortcutConfig {
  save: string;
  toggleView: string;
  aiAnalyze: string;
  search: string;
  sidebarSearch: string;
  locateCurrentFile: string;
  settings: string;
  toggleOutline: string;
  toggleSidebar: string;
  toggleTheme: string;
  newNote: string;
  newFolder: string;
  newWindow: string;
  closeTab: string;
  openKnowledgeBase: string;
  exportPdf: string;
  commandPalette: string;
}

export interface MetadataField {
  key: string;
  defaultValue: string;
  /** Optional human-readable explanation shown in settings. */
  description: string;
}

export interface KnowledgeBaseMeta {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export type ThemeMode = "light" | "dark";
export type AppLanguage = "zh-CN" | "en";
export type AttachmentPasteFormat = "markdown" | "obsidian";
export type NewNoteLocation =
  | "knowledgeBaseRoot"
  | "currentFileFolder"
  | "specifiedFolder";
export type AttachmentLocation =
  | "resourceFolder"
  | "sameAsCurrent"
  | "subfolderUnderCurrent";
export type OrderedListMode = "strict" | "loose";
export type MarkdownStylePreset =
  | "nord"
  | "topaz"
  | "typewriter"
  | "primary"
  | "minimal"
  | "things"
  | "catppuccin"
  | "solarized";
export type SearchMode = "keyword" | "semantic" | "hybrid";
export type EmbeddingProviderId = "none" | "builtin" | "openai-compatible";
export type BuiltinEmbeddingDownloadConsent = "unknown" | "granted" | "denied";

export type ImageHostingProvider =
  | "none"
  | "github"
  | "s3"
  | "aliyun_oss"
  | "qiniu"
  | "custom";
export type ImagePasteAction = "local" | "upload";

export interface ImageHostingGitHubConfig {
  repo: string;
  branch: string;
  path: string;
  customDomain: string;
}

export interface ImageHostingS3Config {
  endpoint: string;
  region: string;
  bucket: string;
  pathPrefix: string;
  accessKeyId: string;
  customDomain: string;
}

export interface ImageHostingAliyunOssConfig {
  endpoint: string;
  bucket: string;
  pathPrefix: string;
  accessKeyId: string;
  customDomain: string;
}

export interface ImageHostingQiniuConfig {
  bucket: string;
  zone: string;
  accessKey: string;
  pathPrefix: string;
  domain: string;
}

export interface ImageHostingCustomConfig {
  uploadUrl: string;
  method: "POST" | "PUT";
  headers: string;
  fileFieldName: string;
  responseUrlJsonPath: string;
}

export interface ImageHostingConfig {
  provider: ImageHostingProvider;
  pasteAction: ImagePasteAction;
  keepLocalCopy: boolean;
  github: ImageHostingGitHubConfig;
  s3: ImageHostingS3Config;
  aliyunOss: ImageHostingAliyunOssConfig;
  qiniu: ImageHostingQiniuConfig;
  custom: ImageHostingCustomConfig;
}

export interface AppSettings {
  language: AppLanguage;
  aiProvider: AIProvider;
  fontDefaultsVersion: number;
  uiFontFamily: string;
  uiFontSize: number;
  editorFontFamily: string;
  previewFontFamily: string;
  codeFontFamily: string;
  fontSize: number;
  wordWrap: boolean;
  formatMarkdownOnManualSave: boolean;
  /** When true, manual/system saves fill missing frontmatter keys from the metadata template. */
  fillMissingFrontmatterOnSave: boolean;
  /** When true, manual/system saves refresh frontmatter update-time fields. */
  refreshFrontmatterOnSave: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  readableLineLength: boolean;
  showLineNumbers: boolean;
  tabSize: number;
  useTabs: boolean;
  enableFolding: boolean;
  spellcheck: boolean;
  showIndentationGuides: boolean;
  convertHtmlOnPaste: boolean;
  resourceFolder: string;
  wikiFolder: string;
  trashFolder: string;
  newNoteLocation: NewNoteLocation;
  /** Relative path used when newNoteLocation === "specifiedFolder". */
  newNoteFolder: string;
  attachmentLocation: AttachmentLocation;
  defaultViewMode: ViewMode;
  attachmentPasteFormat: AttachmentPasteFormat;
  orderedListMode: OrderedListMode;
  markdownStylePreset: MarkdownStylePreset;
  blogRepoUrl: string;
  blogSiteUrl: string;
  blogGithubToken?: string;
  wechatAppId: string;
  wechatAppSecret?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  codexApiBaseUrl?: string;
  codexApiKey?: string;
  codexModel?: string;
  deepseekApiBaseUrl?: string;
  deepseekApiKey?: string;
  deepseekModel?: string;
  aiSystemPrompt?: string;
  aiSystemPromptZh?: string;
  aiSystemPromptEn?: string;
  wikiPromptTemplate?: string;
  wikiPromptTemplateZh?: string;
  wikiPromptTemplateEn?: string;
  /** Retrieval / embedding (Phase 2) */
  searchModeDefault?: SearchMode;
  embeddingProvider?: EmbeddingProviderId;
  embeddingApiBaseUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  /** Hub used to download builtin embedding weights */
  embeddingHub?: "auto" | "huggingface" | "hf-mirror";
  /** 首次下载内置 embedding 权重前的用户同意状态 */
  builtinEmbeddingDownloadConsent?: BuiltinEmbeddingDownloadConsent;
  privacyMode?: boolean;
  /** Vault-relative globs skipped by Ask Vault / chunk index. */
  indexExcludeGlobs?: string[];
  imageHosting: ImageHostingConfig;
  imageHostingGithubToken?: string;
  imageHostingS3SecretAccessKey?: string;
  imageHostingOssAccessKeySecret?: string;
  imageHostingQiniuSecretKey?: string;
  shortcuts: ShortcutConfig;
  knowledgeBases: KnowledgeBaseMeta[];
  lastKnowledgeBasePath?: string;
  lastOpenedFilePath?: string;
  themeMode: ThemeMode;
  /** When true, themeMode follows the OS light/dark preference automatically. */
  themeFollowSystem: boolean;
  metadataFields: MetadataField[];
  autoSaveInterval: number; // Auto-save interval in milliseconds
  autoCheckForUpdates: boolean;
  skippedUpdateVersion: string;
  lastUpdateCheckAt: string;
}

export type NotificationType = "success" | "error" | "info" | "warning";

export interface Notification {
  msg: string;
  type: NotificationType;
}

export interface DragDropEvent {
  payload: {
    paths: string[];
  };
}
