export default {
  common_done: "Done",
  common_cancel: "Cancel",
  common_confirm: "Confirm",
  common_create: "Create",
  common_delete: "Delete",
  common_language: "Language",
  common_interface: "Interface",
  common_simplifiedChinese: "Simplified Chinese",
  common_english: "English",
  common_loading: "Loading...",

  app_restoringWorkspace: "Restoring Workspace",
  app_restoringWorkspaceDesc:
    "Opening your last knowledge base and restoring the workspace.",
  app_openingKnowledgeBase: "Opening knowledge base...",
  app_openingDocument: "Opening Document",
  app_openingDocumentDesc: "Opening the selected file.",
  app_openingDocumentStatus: "Opening file...",
  app_chooseKnowledgeBase: "Choose Your Knowledge Base",
  app_chooseKnowledgeBaseDesc:
    "Open a folder as your knowledge base to start writing.",
  app_openKnowledgeBase: "Open Knowledge Base",
  app_saved: "Saved",
  app_newFile: "New File",
  app_fileName: "File name:",
  app_untitled: "Untitled",
  app_untitledDrawing: "Untitled Drawing",
  app_untitledFolder: "Untitled Folder",

  toolbar_hideSidebar: "Hide sidebar",
  toolbar_showSidebar: "Show sidebar",
  toolbar_saving: "Saving...",
  toolbar_noFileSelected: "No file selected",
  toolbar_switchToLight: "Switch to light mode",
  toolbar_switchToDark: "Switch to dark mode",
  toolbar_uploadImage: "Upload image to hosting",
  toolbar_uploadingImage: "Uploading image",
  toolbar_publish: "Publish",
  toolbar_publishing: "Publishing",
  toolbar_publishBlog: "Publish blog",
  toolbar_publishingBlog: "Publishing blog",
  toolbar_exportPdf: "Export PDF",
  toolbar_export: "Export",
  toolbar_exportHtml: "Export HTML",
  toolbar_shareLongImage: "Long image share",

  share_longImageTitle: "Long image share",
  share_longImageDesc:
    "Render the current preview as one tall PNG. Scroll to inspect, then save, copy, or use the system share sheet.",
  share_generate: "Generate image",
  share_generating: "Generating…",
  share_savePng: "Save PNG",
  share_copyImage: "Copy image",
  share_systemShare: "Share…",
  share_previewAlt: "Long image preview",

  publish_targetTitle: "Choose publish target",
  publish_targetDesc:
    "This entry can publish to the blog or the WeChat Official Account draft box.",
  publish_targetSimpleBlog: "Simple Blog",
  publish_targetSimpleBlogDesc:
    "Sync to the blog repository and trigger deployment.",
  publish_targetWechatDraft: "WeChat draft",
  publish_targetWechatDraftDesc:
    "Create or update a single-article draft in the Official Account draft box.",

  wechatDraftDialog_title: "Publish to WeChat drafts",
  wechatDraftDialog_desc:
    "Review the article metadata and pick a cover image before publishing.",
  wechatDraftDialog_updateHint:
    "This note is already linked to a WeChat draft, so publishing will update that draft.",
  wechatDraftDialog_titleLabel: "Title",
  wechatDraftDialog_authorLabel: "Author",
  wechatDraftDialog_sourceUrlLabel: "Source URL",
  wechatDraftDialog_digestLabel: "Digest",
  wechatDraftDialog_coverLabel: "Cover image",
  wechatDraftDialog_coverDesc:
    "The cover image is uploaded as a WeChat thumbnail asset. Local body images are converted into WeChat-hosted article images automatically.",
  wechatDraftDialog_showCover: "Show cover in article",
  wechatDraftDialog_pickCover: "Choose cover image",
  wechatDraftDialog_coverEmpty: "No cover image selected yet",
  wechatDraftDialog_submit: "Publish to drafts",
  wechatDraftDialog_previewTitle: "Phone preview",
  wechatDraftDialog_previewHint:
    "Approximate Official Account article width. Check layout and images before publishing.",
  wechatDraftDialog_previewLoading: "Building preview…",
  wechatDraftDialog_previewFailed:
    "Could not build the preview. You can still try to publish.",
  wechatDraftDialog_imageCount: "{count} body image(s) will be uploaded",
  wechatDraftDialog_unresolvedImages:
    "{count} image(s) could not be resolved. Fix the paths before publishing:",
  wechatDraftDialog_ipHint:
    "If the API says the IP is not allowlisted, add this machine's public IP under Official Account Settings → Basic Configuration → IP whitelist.",

  simpleBlogDialog_title: "Publish to Simple Blog",
  simpleBlogDialog_desc:
    "Confirm the article title, slug, and aliases before publishing. Configure the blog repository, token, and site domain in Settings.",
  simpleBlogDialog_titleLabel: "Title",
  simpleBlogDialog_slugLabel: "Slug",
  simpleBlogDialog_slugDesc:
    "Controls the article URL. Leave empty to fall back to the title.",
  simpleBlogDialog_aliasesLabel: "Aliases",
  simpleBlogDialog_aliasesDesc:
    "Optional. Separate multiple aliases with commas. Leave empty to match the title.",
  simpleBlogDialog_submit: "Publish to blog",

  ai_button: "AI Enhance",
  ai_buttonLoading: "Enhancing with AI",
  ai_generateWiki: "Generate explainer wiki with AI",
  ai_generatingWiki: "Generating wiki...",

  view_editorOnly: "Source only",
  view_livePreview: "Live preview",
  view_split: "Split view",
  view_preview: "Reading view",

  split_toggleOutline: "Toggle outline",
  split_hideOutline: "Hide side panel",
  split_showOutline: "Outline / Links",

  outline_title: "Outline",
  outline_empty: "No headings found",
  outline_expand: "Expand",
  outline_collapse: "Collapse",

  links_title: "Links",
  links_noFile: "Open a note to inspect links",
  links_building: "Building link index… ({done}/{total})",
  links_backlinks: "Backlinks",
  links_backlinksEmpty: "No backlinks yet",
  links_outbounds: "Outgoing links",
  links_outboundsEmpty: "No outgoing links",
  links_unresolved: "Unresolved links",
  links_unresolvedEmpty: "No dead links",
  links_createNote: "Create",
  links_neighborhood: "Neighborhood",
  links_neighborhoodExpand: "Expand neighborhood",
  links_neighborhoodExpandHint: "Click to enlarge and show titles",
  links_neighborhoodDialog: "Neighborhood graph",

  askVault_title: "Ask vault",
  askVault_short: "Ask",
  askVault_moduleHint:
    "Works beside the editor: retrieve, answer, jump to sources",
  askVault_resize: "Resize Ask vault panel",
  askVault_tabAsk: "Ask",
  askVault_scope: "Search scope",
  askVault_scopeVault: "Entire vault",
  askVault_scopeFolder: "Current folder",
  askVault_scopeCurrent: "Current note",
  askVault_scopeNeedsNote:
    "Open a note first to use current folder / current note scope.",
  askVault_placeholder:
    "Ask in natural language, e.g. What was the last conclusion about the release process?",
  askVault_retrieve: "Retrieve only",
  askVault_retrieving: "Retrieving…",
  askVault_ask: "Generate answer",
  askVault_asking: "Generating…",
  askVault_retrieveHint:
    "Retrieve snippets without calling AI — review sources first if you want.",
  askVault_confirmSend: "Confirm send and generate",
  askVault_confirmSendHint:
    "{count} snippet(s) will be sent to the model. Click a snippet to jump back. Generated text is never applied silently.",
  askVault_toggleSources: "Show snippets to send",
  askVault_sourcesPreview: "Snippets to send",
  askVault_sourcesTab: "Sources",
  askVault_sourcesHint:
    "These snippets are sent as model context. Review them, then click Confirm send and generate.",
  askVault_sourcesEmpty:
    "After Generate answer or Retrieve only, matching snippets appear here.",
  askVault_answer: "Answer",
  askVault_answerEmpty:
    "Type a question, review the snippets to send, then generate (Cmd/Ctrl+Enter).",
  askVault_insert: "Insert into current note (confirm required)",
  askVault_insertNeedsNote: "Open a note before inserting.",
  askVault_citations: "Citations",
  askVault_history: "History",
  askVault_historyEmpty: "No past questions yet.",
  askVault_historyCitations: "{count} citations",
  askVault_statusReady: "Ready",
  askVault_statusKeyword: "Keyword mode",
  askVault_statusBlocked: "Not ready",
  askVault_failed: "Ask vault failed",
  askVault_noHits:
    "No relevant snippets found. Try another question or configure embeddings.",
  askVault_sourcesStale:
    "Retrieved snippets are stale (files moved or deleted). Please retrieve again.",
  askVault_sourcesRefreshed:
    "Some sources are gone; continuing with the remaining snippets.",
  askVault_needVault: "Open a knowledge base first.",
  askVault_needAi: "AI is not configured.",
  askVault_openAiSettings: "Configure AI",
  askVault_openIndexSettings: "Configure embeddings",
  askVault_indexBuilding: "Building index… ({done}/{total})",
  askVault_indexEmpty: "Index is empty.",
  askVault_rebuildIndex: "Rebuild index",
  askVault_keywordOnly:
    "Keyword mode only — natural-language questions work better with embeddings.",
  askVault_ready: "Ready (semantic retrieval available)",
  askVault_readyKeyword: "Ready (keyword retrieval)",

  index_title: "Vault index",
  index_desc:
    "Link and chunk indexes power backlinks, sidebar search, related notes, and Ask vault. Cached locally and rebuildable anytime without changing your Markdown. Ask vault also needs a model under AI settings.",
  index_status: "Status",
  index_statusReady: "Ready",
  index_statusBuilding: "Building ({done}/{total})",
  index_statusUpdating: "Updating",
  index_statusError: "Error",
  index_notesIndexed: "Notes indexed",
  index_lastBuilt: "Last built",
  index_neverBuilt: "Not built yet",
  index_rebuild: "Rebuild link index",
  index_rebuilding: "Rebuilding…",
  index_rebuildDone: "Link index rebuilt",
  index_rebuildFailed: "Rebuild failed",
  index_noVault: "Open a knowledge base first",
  index_chunksIndexed: "Chunks indexed",
  index_vectors: "Vector index",
  index_vectorsReady: "Ready ({count})",
  index_vectorsOff: "Disabled",
  index_embeddingTitle: "Semantic search / Embedding",
  index_embeddingDesc:
    "Uses a built-in on-device model by default (first run downloads tens of MB, then works offline). You can also point at Ollama or another OpenAI-compatible endpoint. Off = keyword only.",
  index_embeddingProvider: "Embedding provider",
  index_embeddingBuiltin: "Built-in local model (recommended)",
  index_embeddingNone: "Off (keyword only)",
  index_embeddingOpenAICompatible: "OpenAI-compatible (Ollama / LM Studio…)",
  index_embeddingBuiltinModel: "Built-in model",
  index_embeddingBuiltinStatus: "Model status",
  index_embeddingBuiltinIdle: "Not loaded yet",
  index_embeddingBuiltinLoading: "Downloading / loading… {percent}%",
  index_embeddingBuiltinReady: "Ready",
  index_embeddingBuiltinError: "Failed to load",
  index_embeddingBuiltinHint:
    "Weights are cached on this device. The first download needs network access; if Hugging Face is blocked, switch the model hub to the China mirror.",
  index_embeddingBuiltinDownload: "Download and load model",
  index_embeddingBuiltinReload: "Reload model",
  index_embeddingHub: "Model download source",
  index_embeddingHubActive: "Active source",
  index_embeddingHubAuto: "Auto (official, then mirror)",
  index_embeddingHubHuggingFace: "Hugging Face",
  index_embeddingHubMirror: "China mirror (hf-mirror)",
  index_embeddingHubHint:
    "Prefer the China mirror when huggingface.co is unreachable. After switching, click Download again.",
  index_embeddingBaseUrl: "API Base URL",
  index_embeddingModel: "Embedding model",
  index_embeddingApiKey: "API Key (optional)",
  index_searchModeDefault: "Default search mode",
  index_privacyMode: "Privacy mode (block non-local embedding endpoints)",
  index_privacyModeDesc:
    "When enabled, custom embeddings may only use localhost / 127.0.0.1. The built-in model always runs on-device.",

  search_mode_label: "Search mode",
  search_mode_keyword: "Keyword",
  search_mode_semantic: "Semantic",
  search_mode_hybrid: "Hybrid",
  search_mode_keyword_short: "Keyword",
  search_mode_semantic_short: "Semantic",
  search_mode_hybrid_short: "Hybrid",
  search_mode_cycleHint: "Click to switch",

  related_tab: "Related",
  related_title: "Related notes",
  related_noFile: "Open a note to see related notes",
  related_loading: "Finding related notes…",
  related_empty: "No related notes yet",

  stats_characters: "Characters",
  stats_words: "Words",
  stats_paragraphs: "Paragraphs",
  stats_readingTime: "Reading time",
  stats_minutes: "{count} min",

  sidebar_search: "Search",
  sidebar_newNote: "New note",
  sidebar_noLocalFilesOpened: "No local files opened.",
  sidebar_openKnowledgeBaseHint:
    "Use the button below to open a knowledge base.",
  sidebar_openKnowledgeBaseDisabledStandalone:
    "This window was opened from a single file in the system file browser, so switching knowledge bases is disabled. Open a knowledge base from inside the app instead.",
  sidebar_searchingNotes: "Searching notes...",
  sidebar_noMatchingFiles: "No matching files",
  sidebar_tryAnotherKeyword: "Try another keyword.",
  sidebar_filenameMatched: "Filename match",
  sidebar_paragraphAroundLine: "Around line {line}",
  sidebar_tryAnotherFilenameKeyword: "Try another filename keyword.",
  sidebar_trash: "Trash ({count})",
  sidebar_trashEmpty: "Empty",
  sidebar_fileTypeNotSupported: "This file type cannot be opened",
  sidebar_cleanupUnusedAttachments: "Clean unused attachments",
  sidebar_cleanupUnusedAttachmentsTitle: "Clean unused attachments",
  sidebar_cleanupUnusedAttachmentsConfirm:
    "Move {count} unreferenced attachment(s) to Trash. You can restore them from Trash later.",
  sidebar_newFileTitle: "New File",
  sidebar_newDrawingTitle: "New Drawing",
  sidebar_renameTitle: "Rename",
  sidebar_newFolderTitle: "New Folder",
  sidebar_folderName: "Folder name:",
  sidebar_newName: "New name:",
  sidebar_deleteItemTitle: "Delete Item",
  sidebar_deleteItemConfirm: 'Delete "{name}"? This action cannot be undone.',
  sidebar_emptyTrashTitle: "Empty Trash",
  sidebar_emptyTrashConfirm:
    "Permanently delete {count} item(s) from trash? This action cannot be undone.",

  context_restore: "Restore",
  context_deleteForever: "Delete Permanently",
  context_newFile: "New File",
  context_newDrawing: "New Drawing",
  context_newFolder: "New Folder",
  context_rename: "Rename",
  context_copyRelativePath: "Copy Path",
  context_openInFinder: "Open in Finder",
  context_openInNewWindow: "Open in New Window",
  context_delete: "Delete",
  context_emptyTrash: "Empty Trash",

  tab_closeTab: "Close file",
  tab_closeBlockedUnsaved:
    "Save failed. The current file was kept open to avoid losing unsaved changes.",
  notifications_moveToTrashSaveFailed:
    "Could not move to trash: saving unsaved changes failed, the file was kept.",
  notifications_renameSaveFailed:
    "Could not rename: saving unsaved changes failed, the original file was kept.",
  notifications_moveSaveFailed:
    "Could not move: saving unsaved changes failed, the original location was kept.",
  notifications_switchKnowledgeBaseSaveFailed:
    "Could not switch knowledge base because unsaved notes failed to save.",
  notifications_aiApplyStale:
    "The note changed while the review was open. Apply was cancelled to avoid overwriting your edits.",
  notifications_exportMarkdownOnly:
    "Export and publish are only available for Markdown notes.",
  draft_restoreTitle: "Unsaved backup found",
  draft_restoreMessage:
    'A backup of "{name}" was kept after a failed save and differs from the file on disk. Restore the backup? Choosing "Discard backup" deletes it and keeps the version on disk.',
  draft_restoreConfirm: "Restore backup",
  draft_restoreDiscard: "Discard backup",
  ai_reviewTitle: "AI enhancement result",
  ai_reviewDescription:
    "Review the content below. Applying replaces the current note (undoable).",
  ai_reviewLengthChange: "Characters {before} → {after}",
  ai_reviewApply: "Apply",
  ai_reviewDiscard: "Discard",
  errorBoundary_title: "Something went wrong",
  errorBoundary_fallbackMessage:
    "An unexpected error occurred in this component.",
  errorBoundary_retry: "Try Again",
  imageHosting_title: "Image Hosting",
  imageHosting_provider: "Provider",
  imageHosting_providerNone: "None (local)",
  imageHosting_providerS3: "S3 Compatible (AWS / R2 / MinIO)",
  imageHosting_providerAliyunOss: "Aliyun OSS",
  imageHosting_providerQiniu: "Qiniu",
  imageHosting_providerCustom: "Custom API",
  imageHosting_onPaste: "On Paste",
  imageHosting_uploadToHosting: "Upload to hosting",
  imageHosting_saveLocally: "Save locally",
  imageHosting_keepLocalCopy: "Keep local copy after upload",
  imageHosting_keepLocalCopyDesc: "Also save to local resources folder",
  imageHosting_repository: "Repository",
  imageHosting_repositoryDesc:
    "Use owner/repo or paste https://github.com/owner/repo",
  imageHosting_branch: "Branch",
  imageHosting_path: "Path",
  imageHosting_customDomainOptional: "Custom domain (optional)",
  imageHosting_githubCdnDesc: "CDN domain to replace raw.githubusercontent.com",
  imageHosting_s3Compatible: "S3 Compatible",
  imageHosting_pathPrefix: "Path prefix",
  imageHosting_zone: "Zone",
  imageHosting_domain: "Domain",
  imageHosting_qiniuDomainDesc: "Qiniu requires a bound domain to access files",
  imageHosting_uploadUrl: "Upload URL",
  imageHosting_method: "Method",
  imageHosting_fileFieldName: "File field name",
  imageHosting_headersJson: "Headers (JSON)",
  imageHosting_responseUrlJsonPath: "Response URL JSON path",
  imageHosting_responseUrlJsonPathDesc:
    "JSON path to extract URL, e.g. data.url",
  imageHosting_testing: "Testing...",
  imageHosting_testSuccess: "Success",
  imageHosting_testFailed: "Failed",
  imageHosting_testConnection: "Test Connection",
  imageHosting_qiniuZoneZ0: "East China",
  imageHosting_qiniuZoneZ1: "North China",
  imageHosting_qiniuZoneZ2: "South China",
  imageHosting_qiniuZoneNa0: "North America",
  imageHosting_qiniuZoneAs0: "Southeast Asia",
  imageHosting_qiniuZoneCnEast2: "East China (Zhejiang 2)",

  search_find: "Find",
  search_searchPlaceholder: "Search...",
  search_replacePlaceholder: "Replace with...",
  search_caseSensitive: "Case sensitive",
  search_regex: "Regex",
  search_wholeWord: "Whole word",
  search_prevMatch: "Previous match (Shift+Enter)",
  search_nextMatch: "Next match (Enter)",
  search_replace: "Replace",
  search_replaceAll: "Replace all",
  search_searching: "Searching...",
  search_matchCount: "{current} / {total} matches",
  search_noMatches: "No matches found",
  search_resultsTruncated: "Too many matches; showing the first {count}",

  export_title: "Export",
  export_format: "Format",
  export_options: "Options",
  export_html: "HTML",
  export_includeToc: "Include table of contents",
  export_lightTheme: "Light theme",
  export_darkTheme: "Dark theme",
  export_currentFile: "Exporting: {name}.md",
  export_exporting: "Exporting...",
  export_pdfExported: "PDF exported",
  export_htmlExported: "HTML exported",
  export_failed: "Export failed",

  settings_title: "Settings",
  settings_tab_editor: "Editor",
  settings_tab_ai: "AI",
  settings_tab_index: "Index",
  settings_tab_metadata: "Metadata",
  settings_tab_shortcuts: "Shortcuts",
  settings_tab_interface: "Interface",
  settings_tab_imageHosting: "Image Hosting",
  settings_tab_publishing: "Publishing",
  settings_tab_about: "About",
  settings_interface: "Interface",
  settings_languageLabel: "Display language",
  settings_interfaceDesc: "Choose the language used by the app interface.",
  settings_themeLabel: "Appearance",
  settings_themeLight: "Light",
  settings_themeDark: "Dark",
  settings_themeSystem: "Follow system",
  settings_themeDesc:
    "Pick a light or dark theme, or follow the operating system appearance automatically.",
  settings_uiFont: "UI font",
  settings_uiFontDesc:
    "Applies only to the app UI. The default uses the system font, and you can switch to the bundled font or another system font.",
  settings_systemDefaultFontOption: "System default font",
  settings_uiFontSize: "UI font size",
  settings_uiFontSizeDesc:
    "Adjusts display scale for the interface, editor, and preview. Use Cmd/Ctrl + +/- for quick changes with an on-screen percentage hint.",
  settings_zoomUiIn: "Zoom UI in",
  settings_zoomUiInDesc:
    "Increase the text size of the sidebar, toolbar, settings, and other UI chrome.",
  settings_zoomUiOut: "Zoom UI out",
  settings_zoomUiOutDesc:
    "Decrease the text size of the sidebar, toolbar, settings, and other UI chrome.",
  settings_zoomUiReset: "Reset UI zoom",
  settings_zoomUiResetDesc:
    "Restore the default UI text size (Cmd/Ctrl+Shift+0; Cmd/Ctrl+0 still opens Settings).",
  settings_uiFontCurrentOption: "Current custom stack",
  settings_uiFontPreview:
    "UI font preview: Mozi settings, sidebar, and toolbar",
  settings_editorFont: "Editor font",
  settings_editorFontDesc:
    "Controls editor body typography without splitting Chinese and English.",
  settings_editorFontSize: "Editor font size",
  settings_editorFontPreview: "Editor font preview: writing Markdown content",
  settings_previewFont: "Preview font",
  settings_previewFontDesc:
    "Controls preview typography and exported PDF body text.",
  settings_previewFontPreview:
    "Preview font preview: rendered Markdown content",
  settings_codeFont: "Code font",
  settings_codeFontDesc:
    "Controls code blocks in the editor, preview, and exported PDF.",
  settings_codeFontPreview: 'const note = "Mozi";',

  settings_workspace: "Workspace",
  settings_workspaceDesc: "Core app actions and view switching.",
  settings_saveFile: "Save File",
  settings_saveFileDesc: "Save the current note to disk.",
  settings_toggleView: "Toggle View",
  settings_toggleViewDesc: "Cycle between Source, Split, and Reading.",
  settings_toggleOutline: "Toggle Outline",
  settings_toggleOutlineDesc: "Show or hide the document outline panel.",
  settings_toggleSidebar: "Toggle Sidebar",
  settings_toggleSidebarDesc: "Show or hide the file sidebar.",
  settings_openKnowledgeBase: "Open Knowledge Base",
  settings_openKnowledgeBaseDesc: "Switch to another local knowledge base.",
  settings_locateCurrentFile: "Locate Current File",
  settings_locateCurrentFileDesc:
    "Expand the tree and scroll to the currently open file.",
  settings_openSettings: "Open Settings",
  settings_openSettingsDesc: "Open the settings panel.",
  settings_toggleTheme: "Toggle Theme",
  settings_toggleThemeDesc:
    "Switch between light and dark themes (turns off system following).",
  settings_shortcutConflict:
    'Already used by "{label}". Choose a different combination.',
  settings_editing: "Editing",
  settings_editingDesc: "Shortcuts for writing and editing content.",
  settings_newNote: "New Note",
  settings_newNoteDesc:
    "Create a new note using the configured storage location.",
  settings_notes: "Notes",
  settings_newNoteLocation: "New note location",
  settings_newNoteLocationDesc: "Choose where newly created notes are stored.",
  settings_newNoteLocationRoot: "Knowledge base root",
  settings_newNoteLocationCurrentFolder: "Current file folder",
  settings_newNoteLocationSpecifiedFolder: "Specified folder",
  settings_newNoteFolder: "Specified folder path",
  settings_newNoteFolderPlaceholder: "notes (relative to vault root)",
  settings_newNoteFolderDesc:
    "Path relative to the knowledge base root for new notes.",
  settings_editorBehavior: "Editor",
  settings_readableLineLength: "Readable line length",
  settings_readableLineLengthDesc:
    "Limit the editor's maximum line width for easier reading.",
  settings_showLineNumbers: "Show line numbers",
  settings_enableFolding: "Fold headings and code",
  settings_enableFoldingDesc: "Allow folding headings, code blocks, and more.",
  settings_showIndentationGuides: "Show indentation guides",
  settings_spellcheck: "Spellcheck",
  settings_tabSize: "Indent size",
  settings_tabSizeDesc: "Number of spaces per indentation level.",
  settings_useTabs: "Indent using tabs",
  settings_useTabsDesc: "Use tab characters when on; use spaces when off.",
  settings_autoPairBrackets: "Auto pair brackets",
  settings_autoPairMarkdown: "Auto pair Markdown syntax",
  settings_convertHtmlOnPaste: "Convert HTML to Markdown on paste",
  settings_convertHtmlOnPasteDesc:
    "Convert HTML from web pages and similar sources to Markdown when pasting.",
  settings_defaultViewMode: "Default view mode",
  settings_defaultViewModeDesc:
    "Initial view when the app starts (Live preview or Reading). After you choose a mode, switching files keeps it.",
  settings_defaultViewModeEditor: "Source",
  settings_defaultViewModeLive: "Live preview",
  settings_defaultViewModePreview: "Reading",
  settings_defaultViewModeSplit: "Split",
  settings_attachmentLocation: "Default location for new attachments",
  settings_attachmentLocationDesc:
    "Where pasted or inserted attachments are saved by default.",
  settings_attachmentLocationResourceFolder: "Resource folder",
  settings_attachmentLocationSameAsCurrent: "Same folder as current file",
  settings_attachmentLocationSubfolder: "In subfolder under current folder",
  settings_newFolder: "New Folder",
  settings_newFolderDesc: "Create a new folder in the knowledge base root.",
  settings_newWindow: "New Window",
  settings_newWindowDesc: "Open a new application window (desktop).",
  settings_closeTab: "Close File",
  settings_closeTabDesc: "Close the current file.",
  settings_aiEnhance: "AI Enhance",
  settings_aiEnhanceDesc: "Run AI enhancement on the current note.",
  settings_undo: "Undo",
  settings_undoDesc: "Undo the most recent content change.",
  settings_redo: "Redo",
  settings_redoDesc: "Reapply the last undone change.",
  settings_search: "Search",
  settings_searchDesc: "Open search and jump between matches.",
  settings_openSearch: "Open Search",
  settings_openSearchDesc: "Open the search panel for the current note.",
  settings_sidebarSearch: "Sidebar Search",
  settings_sidebarSearchDesc:
    "Open the sidebar and focus the file search field.",
  settings_nextMatch: "Next Match",
  settings_nextMatchDesc: "Jump to the next match in the search panel.",
  settings_previousMatch: "Previous Match",
  settings_previousMatchDesc: "Jump to the previous match in the search panel.",
  settings_panelsAndDialogs: "Panels & Dialogs",
  settings_panelsAndDialogsDesc:
    "Dismiss temporary UI like search, dialogs, and menus.",
  settings_closeActivePanel: "Close Active Panel",
  settings_closeActivePanelDesc:
    "Close the active search panel, dialog, or context menu.",
  settings_exportPdf: "Export PDF",
  settings_exportPdfDesc: "Export the current preview as a PDF file.",
  settings_cleanupUnusedAttachments: "Clean Up Unused Attachments",
  settings_cleanupUnusedAttachmentsDesc:
    "Remove files in the resource folder that are not referenced by any Markdown file.",
  settings_shortcutsTitle: "Shortcuts",
  settings_shortcutsIntro:
    "Shortcuts are grouped by workflow. For editable items, click the control on the right and press your shortcut; built-in shortcuts are shown for reference.",
  settings_shortcutRecordHint: "Click to record",
  settings_shortcutListening: "Press a key combination…",
  settings_shortcutEscToCancel: "Esc to cancel",

  settings_aiContentEnhance: "AI Content Enhancement",
  settings_aiContentEnhanceDesc:
    "Choose an AI provider for note enhancement, wiki generation from selection, and Ask vault. Ask vault also needs the Index tab (chunks / embeddings).",
  settings_aiProvider: "AI provider",
  settings_geminiApiKey: "Gemini API key",
  settings_secureSaving: "Saving to the system keychain...",
  settings_secureSaved: "Saved securely to the system keychain.",
  settings_apiKeyPaste: "Paste API key here...",
  settings_localOnlyGoogle:
    "Stored locally only. Get it from Google AI Studio.",
  settings_geminiModel: "Gemini model",
  settings_loadModelList: "Load models",
  settings_loadingModels: "Loading…",
  settings_pickGeminiModel: "Choose a Gemini model from the list.",
  settings_deepseekBaseUrl: "DeepSeek API Endpoint",
  settings_deepseekBaseUrlExample: "Example: https://api.deepseek.com",
  settings_deepseekModel: "DeepSeek model",
  settings_pickDeepSeekModel: "Choose a DeepSeek model from the list.",
  settings_deepseekApiKey: "DeepSeek API key",
  settings_deepseekApiKeyPaste: "Paste DeepSeek API key here...",
  settings_deepseekApiKeyLocalOnly:
    "Stored locally only. Uses a DeepSeek Platform API key.",
  settings_openaiBaseUrl: "openAI API Endpoint",
  settings_openaiBaseUrlExample: "Example: https://api.openai.com/v1",
  settings_openaiModel: "OpenAI model",
  settings_pickOpenAIModel: "Choose an OpenAI model from the list.",
  settings_openaiApiKey: "OpenAI API key",
  settings_openaiApiKeyPaste: "Paste OpenAI API key here...",
  settings_openaiApiKeyLocalOnly:
    "Stored locally only. Uses a standard OpenAI API key.",
  settings_openaiBillingHint:
    "Note: this uses the OpenAI API, not ChatGPT subscription usage. Billing is determined by the Platform project or org behind the current API key.",
  settings_wikiFolder: "Wiki folder",
  settings_wikiFolderPlaceholder: "Example: wiki",
  settings_wikiFolderDesc:
    "Relative to the knowledge base root. Falls back to `wiki` when empty, then auto-archives generated articles by AI category.",
  settings_modelsLoaded: "Loaded {count} {provider} model(s).",
  settings_noAvailableModels:
    "The API responded, but no usable models were found.",
  settings_modelLoadFailed: "Failed to load models.",
  settings_systemPrompt: "System prompt",
  settings_systemPromptDesc:
    "Uses the built-in preset by default. Changes here apply to full-note enhancement and general AI behavior.",
  settings_systemPromptPlaceholder: "Enter a system prompt...",
  settings_promptChinese: "Chinese version",
  settings_promptEnglish: "English version",
  settings_wikiPrompt: "Wiki prompt",
  settings_wikiPromptDesc:
    "Uses the built-in wiki entry template by default. Edit this to change wiki generation structure, tone, and scope constraints.",
  settings_wikiPromptPlaceholder: "Enter a wiki prompt template...",
  settings_resetDefaultPrompt: "Reset default",

  settings_typography: "Typography",
  settings_fontSize: "Font size",
  settings_markdownStyle: "Markdown style",
  settings_markdownStyleNord: "Nord Inspired",
  settings_markdownStyleTopaz: "Topaz Inspired",
  settings_markdownStyleTypewriter: "Typewriter Inspired",
  settings_markdownStylePrimary: "Primary Inspired",
  settings_markdownStyleMinimal: "Minimal Inspired",
  settings_markdownStyleThings: "Things Inspired",
  settings_markdownStyleCatppuccin: "Catppuccin Inspired",
  settings_markdownStyleSolarized: "Solarized Inspired",
  settings_markdownStyleDesc:
    "Controls Markdown reading styles for the editor, preview, and exported document. Each style supports both light and dark themes.",
  settings_englishFont: "English font",
  settings_englishFontDefaultOption: "Default English font (system)",
  settings_englishFontBundledOption: "Bundled English font (Tsanger JinKai)",
  settings_englishFontDesc: "Used for Latin letters, numbers, and symbols.",
  settings_englishFontPreview: "English font preview: Mozi toolbar and sidebar",
  settings_chineseFont: "Chinese font",
  settings_chineseFontDefaultOption: "Default Chinese font (system)",
  settings_chineseFontBundledOption: "Bundled Chinese font (Tsanger JinKai)",
  settings_chineseFontDesc:
    "Defaults to the system Chinese font, with the bundled Tsanger JinKai available as an option.",
  settings_chineseFontPreview: "Chinese font preview: Mozi toolbar and sidebar",
  settings_wordWrap: "Word wrap",
  settings_attachments: "Attachments",
  settings_resourceFolder: "Resource folder",
  settings_resourceFolderPlaceholder: "resources (folder name)",
  settings_resourceFolderDesc:
    "Pasted images are saved into this folder inside the current knowledge base.",
  settings_trashFolder: "Trash folder",
  settings_trashFolderPlaceholder:
    ".trash (folder name under the knowledge base root)",
  settings_trashFolderDesc:
    "Deleted files are moved into this folder under the current knowledge base root.",
  settings_attachmentPasteFormat: "Attachment paste format",
  settings_attachmentPasteFormatDesc:
    "Choose whether pasted images use Obsidian embeds or standard Markdown image syntax.",
  settings_attachmentFormatObsidian: "Obsidian format: ![[path/to/image.png]]",
  settings_attachmentFormatMarkdown:
    "Markdown format: ![](<path/to/image.png>)",
  settings_lists: "Lists",
  settings_saveFormatting: "Save Formatting",
  settings_formatOnManualSave: "Format on Ctrl/Cmd+S",
  settings_formatOnManualSaveDesc:
    "When saving manually, normalize Markdown by collapsing extra blank lines, adding standard spacing around headings, lists, blockquotes, thematic breaks, tables, link definitions, footnote definitions, and HTML comments, normalizing heading/list/task-list/blockquote/thematic-break syntax, renumbering ordered lists according to the current list mode, and inserting spaces between adjacent Chinese and English text. A lone indented line sandwiched by non-indented paragraphs loses one indent level so it is not parsed as an indented code block (typical paste artifact). Frontmatter, fenced code blocks, and inline code are left unchanged.",
  settings_orderedListMode: "Ordered list numbering",
  settings_orderedListStrict: "Strict mode (Typora): renumber automatically",
  settings_orderedListLoose: "Loose mode (Obsidian): keep existing numbering",
  settings_orderedListModeDesc:
    "Controls whether indent/outdent and ordered-list commands automatically normalize numbering.",
  settings_autoSave: "Auto Save",
  settings_autoSaveInterval: "Auto-save interval",
  settings_autoSaveDesc:
    "Changes are automatically saved to disk after the selected delay.",
  settings_seconds: "{count} s",
  settings_minutes: "{count} min",

  settings_fillMissingFrontmatterOnSave: "Auto-fill on save",
  settings_fillMissingFrontmatterOnSaveDesc:
    "On manual save, fill missing frontmatter fields from the metadata template. Existing fields are not overwritten. Auto-save does not trigger this.",
  settings_refreshFrontmatterOnSave: "Update modified time on save",
  settings_refreshFrontmatterOnSaveDesc:
    "On manual save, automatically refresh frontmatter update-time fields (such as date modified / update_time). Auto-save does not trigger this.",
  settings_metadataTemplate: "Metadata Template",
  settings_metadataTemplateDesc:
    "Fields added to frontmatter when creating a new file.",
  settings_addField: "Add Field",
  settings_dragToReorder: "Drag to reorder",
  settings_metadataKeyLabel: "Key",
  settings_metadataValueLabel: "Default value",
  settings_metadataDescriptionLabel: "Description",
  settings_metadataKeyPlaceholder: "Key (for example: tags)",
  settings_metadataValuePlaceholder: "Value (for example: draft)",
  settings_metadataDescriptionPlaceholder:
    "Description (for example: tag list)",
  settings_metadataNowHint: "Use {now} for the current date",
  settings_metadataTip:
    "Tip: drag to reorder. Use {now} for the date and {nowDatetime} for the timestamp. `status` is only for editorial state; publishing is controlled by `is_publish`.",
  settings_resizeModal: "Drag to resize the settings window",
  settings_resizeNav: "Drag to resize the settings navigation",
  settings_resizeMetadataKeyColumn: "Drag to resize the key column",
  settings_resizeMetadataValueColumn: "Drag to resize the value column",

  settings_publishingTitle: "Publishing",
  settings_publishingTabSimpleBlog: "simple-blog",
  settings_publishingTabWechat: "WeChat",
  settings_aboutTitle: "About",
  settings_aboutDesc:
    "See the current version, check for updates, and review how updates work on each platform.",
  settings_aboutAuthor: "Author",
  settings_aboutAuthorValue: "Yunz93",
  settings_aboutMessage: "Message",
  settings_aboutMessageValue:
    "This is what the ideal Markdown editor looks like to me. I hope you like it too, and feedback is always welcome.",
  settings_aboutJointCertification:
    "Jointly certified by Fable5 + GPT 5.6 + Grok 4.5",
  settings_aboutJointCertificationHint:
    "Reviewed and certified through multi-model collaboration",
  settings_simpleBlogSectionTitle: "Simple Blog",
  settings_simpleBlogSectionDesc:
    "Publish to the simple-blog repository and trigger a new deployment.",
  settings_blogRepoUrl: "Blog repository URL",
  settings_blogRepoUrlPlaceholder:
    "Example: https://github.com/you/simple-blog",
  settings_blogRepoUrlDesc:
    "Enter the GitHub repository used by your deployed `simple-blog`. Publishing writes to this repo through the GitHub API and triggers a new deployment.",
  settings_blogRepoUrlInvalid:
    "Use a GitHub repository URL like `https://github.com/owner/repo`, `git@github.com:owner/repo.git`, or `owner/repo`.",
  settings_githubToken: "GitHub token",
  settings_githubTokenDesc:
    "Required. Publishing uses the GitHub API only, so this token must be configured first.",
  settings_githubTokenPermission:
    "Use a fine-grained personal access token with `Contents: Read and write` permission. The token is stored on this device only.",
  settings_showToken: "Show GitHub token",
  settings_hideToken: "Hide GitHub token",
  settings_blogSiteUrl: "Blog site URL",
  settings_blogSiteUrlPlaceholder: "Example: https://your-blog.com",
  settings_blogSiteUrlDesc:
    "This public site URL is used to write back the article `link`, for example `https://your-blog.com` or `your-blog.vercel.app`.",
  settings_blogSiteUrlInvalid:
    "Use a public URL like `https://your-blog.com` or `your-blog.vercel.app`.",
  settings_wechatSectionTitle: "WeChat Official Account Drafts",
  settings_wechatSectionDesc:
    "Publish the current note to the WeChat Official Account draft box and update the same draft later.",
  settings_wechatAppId: "WeChat AppID",
  settings_wechatAppIdPlaceholder: "Example: wx1234567890abcdef",
  settings_wechatAppIdDesc:
    "Enter the Official Account AppID. It is stored with the normal local settings.",
  settings_wechatAppSecret: "WeChat AppSecret",
  settings_wechatAppSecretPlaceholder: "Paste the AppSecret here...",
  settings_wechatAppSecretDesc:
    "Required. Used to obtain the Official Account access token and stored only in secure local storage.",
  settings_wechatAppSecretHint:
    "Enable developer access in WeChat Official Account settings and make sure your outbound server IP is in the allowlist.",
  settings_wechatGuide1:
    "Publishing to drafts uploads local body images as WeChat article images before creating or updating the draft.",
  settings_wechatGuide2:
    "The first version supports one Official Account only. Republishing the same note prefers the saved `wechat_draft_media_id` and updates that draft.",
  settings_wechatGuide3:
    "The cover image is selected during publishing and uploaded as a WeChat thumbnail asset.",
  settings_desktopPublishOnly:
    "One-click publishing is available in the desktop app only.",
  settings_updatesSectionTitle: "App updates",
  settings_updatesSectionDesc:
    "Windows supports in-app update checks and installation. macOS remains a manual download flow from GitHub Releases for now.",
  settings_updatesDesktopOnly:
    "App updates are available in the desktop app only.",
  settings_updatesMacManualDesc:
    "macOS does not support in-app installation updates in this phase. Download the new build from GitHub Releases and install it manually.",
  settings_updatesOpenReleases: "Open GitHub Releases",
  settings_updatesCurrentVersionLabel: "Current version",
  settings_updatesLastCheckLabel: "Last checked",
  settings_updatesNeverChecked: "Never checked",
  settings_updatesCurrentVersion: "Current version:",
  settings_updatesAutoCheck: "Check for updates on launch",
  settings_updatesAutoCheckDesc:
    "Enabled only for the Windows desktop build. New versions show a reminder without interrupting your current work.",
  settings_updatesCheckNow: "Check now",
  settings_updatesChecking: "Checking for updates...",
  settings_updatesArtifactsDisabled:
    "This build does not ship in-app updater artifacts. Download from GitHub Releases instead.",
  settings_updatesUpToDate: "You are already on the latest version.",
  settings_updatesAvailableStatus: "Update {version} is available.",
  settings_updatesPreparingInstall: "Preparing to install {version}...",
  settings_updatesDownloading: "Downloading the update package...",
  settings_updatesInstalling: "Installing update...",
  settings_updatesInstallNow: "Download and install",
  settings_updatesSkipVersion: "Skip this version",
  settings_updatesResumeSkipped: "Resume reminders",
  settings_updatesSkippedBadge: "Auto reminders paused",
  settings_updatesAvailableVersion: "Update available: {version}",
  settings_updatesPublishedAt: "Published: {date}",
  settings_updatesProgressPercent: "Download progress {percent}%",
  settings_updatesReleaseNotes: "Release notes",
  settings_updatesGuide1:
    "Windows in-app updates depend on the `latest.json` metadata file and signed updater artifacts uploaded to the GitHub Release.",
  settings_updatesGuide2:
    "If you just published a release and the client still does not see it, verify the release contains the updater assets first, then check again.",
  settings_updatesCheckFailed: "Failed to check for updates: {error}",
  settings_updatesInstallFailed: "Failed to install the update: {error}",

  notifications_fileDeletedOnDisk: "The file was deleted on disk.",
  notifications_fileDeletedOnDiskUnsaved:
    "The file was deleted on disk, but it still has unsaved changes. Copy your work before closing.",
  notifications_watchFileFailed: "Failed to watch file changes on disk.",
  notifications_watchDirectoryFailed:
    "Failed to watch knowledge base directory changes on disk.",
  notifications_fileChangedOnDisk:
    "The file changed on disk. Save or discard local edits before reloading.",
  notifications_fileReloaded: "Reloaded the file from disk.",
  notifications_reloadFileFailed:
    "Failed to reload the changed file from disk.",
  notifications_noFileToExport: "No file to export",
  notifications_pdfExported: "PDF exported",
  notifications_exportPdfFailed: "Failed to export PDF",
  notifications_htmlExported: "HTML exported",
  notifications_exportHtmlFailed: "Failed to export HTML",
  notifications_longImageExported: "Long image saved",
  notifications_longImageExportFailed: "Failed to generate long image",
  notifications_longImageCopied: "Image copied to clipboard",
  notifications_longImageCopyFailed: "Failed to copy image",
  notifications_longImageShareFailed: "System share failed",
  notifications_longImageShareUnsupported:
    "This environment cannot hand off the image to the system share sheet",
  notifications_noFileToPublish: "No file to publish",
  notifications_desktopPublishOnly:
    "One-click publish is available in the desktop app only.",
  notifications_setBlogRepoFirst:
    "Set the blog repository URL in Publishing settings first.",
  notifications_setValidBlogRepoFirst:
    "Enter a valid GitHub repository URL in Publishing settings first.",
  notifications_setBlogSiteFirst:
    "Set the blog site URL in Publishing settings first.",
  notifications_setValidBlogSiteFirst:
    "Enter a valid blog site URL in Publishing settings first.",
  notifications_setGithubTokenFirst:
    "Set the GitHub token in Publishing settings first.",
  notifications_setWechatAppIdFirst:
    "Set the WeChat AppID in Publishing settings first.",
  notifications_setWechatAppSecretFirst:
    "Set the WeChat AppSecret in Publishing settings first.",
  notifications_setWechatCoverFirst:
    "Choose a cover image for the WeChat draft first.",
  notifications_wechatTitleRequired: "Enter a title for the WeChat draft.",
  notifications_wechatIpAllowlist:
    "This machine's public IP is not in the Official Account IP allowlist. Add it under Settings → Basic Configuration, then retry.",
  notifications_wechatInvalidAppId:
    "The WeChat AppID is invalid. Check it in Settings → Publishing.",
  notifications_wechatInvalidAppSecret:
    "The WeChat AppSecret is invalid. Paste it again in Settings → Publishing and confirm it has not been reset.",
  notifications_wechatQuotaExceeded:
    "The Official Account API daily quota has been reached. Try again later.",
  notifications_wechatMediaFailed:
    "The cover or body image failed to upload. Use a smaller jpg/png that can be opened.",
  notifications_wechatApiUnauthorized:
    "This Official Account cannot use the draft API. Check the account type and permissions on the WeChat platform.",
  notifications_wechatNetworkFailed:
    "Could not reach the WeChat API. Check the network and retry.",
  notifications_noContentToPublish: "No content to publish",
  notifications_saveBeforePublishFailed:
    "Failed to save the note before publishing.",
  notifications_publishTimeout:
    "Publishing timed out. Check your GitHub connection and token permissions, then try again.",
  notifications_exportQualityReduced:
    "The document is very long, so the export resolution was reduced automatically to avoid a crash.",
  notifications_publishResultUnknown:
    "Timed out waiting for the publish result: it may still have succeeded remotely. Verify the remote state before retrying; local state was not rolled back.",
  notifications_publishInProgress:
    "A publish is already in progress. Wait for it to finish before trying again.",
  notifications_publishBackfillFailed:
    "Published to the blog, but failed to write the article URL back into the note.",
  notifications_publishUrlBuildFailed:
    "Published to the blog, but failed to build the published article URL.",
  notifications_publishSuccess:
    "Published to the blog and updated the note link.",
  notifications_updateAvailable:
    "Update {version} is available. Open Settings → About to install it.",
  notifications_updateNotAvailable: "You already have the latest version.",
  notifications_updateCheckFailed: "Failed to check for updates: {error}",
  notifications_updateInstallFailed: "Failed to install the update: {error}",
  notifications_unresolvedImages:
    "{count} local image(s) could not be found and will be skipped during publish. Please check the image paths.",
  notifications_publishSuccessWithMissingImages:
    "Published to the blog, but {count} local image(s) could not be found and were skipped. Please check the image paths.",
  notifications_publishFailed: "Failed to publish blog",
  notifications_wechatDraftSuccess:
    "Published to the WeChat draft box and updated the note draft marker.",
  notifications_wechatDraftBackfillFailed:
    "Published to the WeChat draft box, but failed to write the draft marker back into the note.",
  notifications_wechatPublishFailed: "Failed to publish the WeChat draft",
  notifications_openKnowledgeBaseBeforePastingImage:
    "Open a knowledge base before pasting images.",
  notifications_imagePastedTo: "Image pasted to {folder}",
  notifications_pasteImageFailed: "Failed to paste image attachment.",
  notifications_imageUploaded: "Image uploaded to hosting",
  notifications_imageUploadFailed: "Image upload failed: {error}",
  notifications_imageFileNotFound: "Image file not found: {path}",
  notifications_imageHostingNotConfigured:
    "Please configure image hosting in Settings first",
  notifications_noUnusedAttachmentsFound: "No unused attachments found.",
  notifications_unusedAttachmentsRemoved:
    "Moved {count} unused attachment(s) to trash.",
  notifications_unusedAttachmentsPartiallyRemoved:
    "Moved {deleted} unused attachment(s) to trash, but {failed} failed.",
  notifications_removeUnusedAttachmentsFailed:
    "Failed to remove unused attachments.",
  notifications_aiConfigFirst: "Please configure AI settings first.",
  notifications_aiEnhanced: "Content enhanced with AI.",
  notifications_aiEnhanceFailed:
    "Failed to enhance content with AI. Check your settings and try again.",
  notifications_aiOpenAIQuotaExceeded:
    "OpenAI API quota has been exceeded. ChatGPT subscriptions and API credits are billed separately; check billing, credits, or the monthly spend limit for the project behind this API key.",
  notifications_aiOpenAIUnauthorized:
    "OpenAI API authentication failed. Check whether the API key is correct and still active.",
  notifications_aiOpenAIForbidden:
    "This OpenAI API key does not have access to the requested resource or model. Check project permissions, org ownership, or model availability.",
  notifications_aiOpenAIRateLimited:
    "The OpenAI API request was rate limited, or the current project hit a throughput limit. Please try again later.",
  notifications_aiOpenAIModelUnavailable:
    "The selected OpenAI model is unavailable. Pick another model in settings.",
  notifications_aiDeepSeekUnauthorized:
    "DeepSeek API authentication failed. Check whether the API key is correct and still active.",
  notifications_aiDeepSeekForbidden:
    "This DeepSeek API key does not have access to the requested resource or model. Check account permissions or model availability.",
  notifications_aiDeepSeekRateLimited:
    "The DeepSeek API request was rate limited, or the current account hit a throughput limit. Please try again later.",
  notifications_aiDeepSeekModelUnavailable:
    "The selected DeepSeek model is unavailable. Pick another model in settings.",
  notifications_noKnowledgeBaseForWiki:
    "No knowledge base folder is available for creating the wiki file.",
  notifications_wikiCreated: "Wiki created: {name}",
  notifications_wikiCreateFailed:
    "Failed to generate the wiki article. Check your AI settings and try again.",
  notifications_invalidWikiTarget: "Invalid wiki link target path",
  notifications_failedOpenLinkInBrowser: "Failed to open link in browser",
  notifications_referenceNotFound: "Reference not found: {target}",
  notifications_headingNotFound: "Heading not found: {target}",
  notifications_linkedFileNotFound: "Linked file not found: {target}",
  notifications_saveBackupCreated:
    "Failed to save to disk. Draft backed up locally.",
  notifications_saveFailed: "Failed to save: {message}",
  notifications_previewNotSupported: "Preview is not supported for {name}",
  notifications_failedToReadFile: "Failed to read file: {name}",
  notifications_permanentlyDeleted: "Permanently deleted.",
  notifications_failedDeleteFile: "Failed to delete file.",
  notifications_trashAlreadyEmpty: "Trash is already empty.",
  notifications_trashEmptied: "Trash emptied.",
  notifications_failedEmptyTrash: "Failed to empty trash.",
  notifications_renameFailed: "Rename failed",
  notifications_invalidTargetFolder: "Invalid target folder",
  notifications_cannotMoveFolderIntoItself: "Cannot move a folder into itself",
  notifications_cannotMoveTrashItemsFromHere:
    "Cannot move trash items from this area",
  notifications_folderMoved: "Folder moved",
  notifications_fileMoved: "File moved",
  notifications_linksUpdated: "Updated links in {count} files",
  notifications_linksSkippedUnsaved:
    "Skipped link updates in {count} files with unsaved changes.",
  notifications_linkUpdateFailed: "Failed to update some links",
  notifications_failedMoveFolder: "Failed to move folder",
  notifications_failedMoveFile: "Failed to move file",
  notifications_moveTargetNotFound: "Move target not found",
  notifications_cannotMoveIntoTrashDirectly:
    "Cannot move items into trash directly",
  notifications_targetFolderNotFound: "Target folder not found",
  notifications_noKnowledgeBaseOpened:
    "No knowledge base opened. Please open one first.",
  notifications_itemNotFound: "Item not found",
  notifications_folderCreated: "Folder created",
  notifications_failedRevealInExplorer: "Failed to reveal in file explorer",
  notifications_openedFileLocationInExplorer:
    "Opened file location in file explorer",
  notifications_failedOpenInFileExplorer: "Failed to open in file explorer",
  notifications_relativePathCopied: "Copied path: {path}",
  notifications_copyRelativePathFailed: "Failed to copy path.",
  notifications_deleted: "Deleted",
  notifications_fileOpenedSuccessfully: "File opened successfully",
  notifications_newWindowDesktopOnly:
    "New windows are only available in the desktop app",
  notifications_openNewWindowFailed: "Could not open a new window: {{error}}",
  notifications_openInNewWindowFailed:
    "Could not open in a new window: {{error}}",
  notifications_sampleNotesSynced: "Sample notes synced to the knowledge base",
  notifications_knowledgeBaseOpenedSuccessfully:
    "Knowledge base opened successfully",
  notifications_revealInExplorerUnsupported:
    "Reveal in file explorer is not supported in this environment",
  notifications_itemAlreadyInTrash: "Item is already in trash.",
  notifications_moveToTrashUnsupported:
    "Move to trash is not supported in this environment.",
  notifications_movedToTrash: "Moved to trash",
  notifications_invalidTrashItemPath: "Invalid trash item path.",
  notifications_restoreFromTrashUnsupported:
    "Restore from trash is not supported in this environment.",
  notifications_restoreTargetExists:
    "Restore target already exists. Rename or move the existing item first.",
  notifications_restoredFromTrash: "Restored from trash",
  notifications_languageSwitched: "Interface language switched to {language}.",

  editor_emptyState: "Select a file to start editing",
  editor_placeholder: "Start writing...",
  editor_livePreviewHeavyFileMode:
    "Large-file optimization: tables, callouts, and Mermaid show placeholders.",
  editor_livePreviewLargeFileMode:
    "Very large file mode: math, images, and wiki Live widgets are off; source remains editable.",
  table_cellHint:
    "Right-click to add/delete rows or columns; Tab/Enter to navigate",
  table_insertRowAbove: "Insert row above",
  table_insertRowBelow: "Insert row below",
  table_deleteRow: "Delete row",
  table_insertColumnLeft: "Insert column left",
  table_insertColumnRight: "Insert column right",
  table_deleteColumn: "Delete column",
  editor_uploadToHosting: "Upload to hosting",
  preview_loading: "Loading...",
  preview_doubleClickReveal: "Double-click to reveal in Finder",
  preview_properties: "Properties",
  preview_imageAlt: "Preview image",
  preview_pdfTitle: "PDF preview",
  preview_htmlTitle: "HTML preview",
  preview_htmlZoomToolbar: "HTML preview zoom",
  preview_htmlZoomFit: "Fit width",
  preview_htmlZoomIn: "Zoom in",
  preview_htmlZoomOut: "Zoom out",
  preview_htmlZoomReset: "Reset to 100%",
  preview_unsupported: "Preview is not supported for this file type.",
  excalidraw_loading: "Loading drawing…",
  excalidraw_loadFailed: "Failed to load the Excalidraw editor",
  excalidraw_invalidDocument: "Could not parse this Excalidraw file",
} as const;
