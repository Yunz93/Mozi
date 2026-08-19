import type { StateCommand } from "@codemirror/state";
import { markdownCommands } from "../editor/behavior";
import { openTableInsertPicker } from "../editor/behavior/tableInsertPicker";
import type { ShortcutConfig } from "../../types";
import type { TranslationKey } from "../../utils/i18n";
import { getActiveEditorView } from "../../utils/editorSelectionBridge";
import { formatShortcutForDisplay } from "../../utils/shortcuts";
import type { PaletteCommand } from "../../utils/commandPalette/filterCommands";

interface CommandPaletteActions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  shortcuts: ShortcutConfig;
  showNeedEditor: () => void;
  save: () => void;
  newNote: () => void;
  newFolder: () => void;
  newWindow: () => void;
  closeTab: () => void;
  toggleView: () => void;
  toggleSidebar: () => void;
  toggleOutline: () => void;
  toggleTheme: () => void;
  search: () => void;
  sidebarSearch: () => void;
  locateCurrentFile: () => void;
  settings: () => void;
  openKnowledgeBase: () => void;
  exportPdf: () => void;
  exportHtml: () => void;
  shareLongImage: () => void;
  publish: () => void;
  askVault: () => void;
}

function runEditorCommand(
  command: StateCommand,
  showNeedEditor: () => void,
): void {
  const view = getActiveEditorView();
  if (!view) {
    showNeedEditor();
    return;
  }
  view.focus();
  command(view);
}

export function buildCommandPaletteItems(
  actions: CommandPaletteActions,
): PaletteCommand[] {
  const { t, shortcuts, showNeedEditor } = actions;
  const workspace = t("commandPalette_groupWorkspace");
  const editor = t("commandPalette_groupEditor");
  const table = t("commandPalette_groupTable");
  const publish = t("commandPalette_groupPublish");

  const workspaceItems: PaletteCommand[] = [
    {
      id: "save",
      title: t("settings_saveFile"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.save),
      run: actions.save,
    },
    {
      id: "newNote",
      title: t("settings_newNote"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.newNote),
      run: actions.newNote,
    },
    {
      id: "command.search",
      title: t("settings_openSearch"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.search),
      run: actions.search,
    },
    {
      id: "settings",
      title: t("settings_openSettings"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.settings),
      run: actions.settings,
    },
    {
      id: "openKnowledgeBase",
      title: t("settings_openKnowledgeBase"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.openKnowledgeBase),
      run: actions.openKnowledgeBase,
    },
    {
      id: "toggleView",
      title: t("settings_toggleView"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.toggleView),
      run: actions.toggleView,
    },
    {
      id: "toggleSidebar",
      title: t("settings_toggleSidebar"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.toggleSidebar),
      run: actions.toggleSidebar,
    },
    {
      id: "toggleOutline",
      title: t("settings_toggleOutline"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.toggleOutline),
      run: actions.toggleOutline,
    },
    {
      id: "toggleTheme",
      title: t("settings_toggleTheme"),
      group: workspace,
      shortcut: formatShortcutForDisplay(shortcuts.toggleTheme),
      run: actions.toggleTheme,
    },
    {
      id: "newFolder",
      title: t("settings_newFolder"),
      group: workspace,
      run: actions.newFolder,
    },
    {
      id: "newWindow",
      title: t("settings_newWindow"),
      group: workspace,
      run: actions.newWindow,
    },
    {
      id: "closeTab",
      title: t("settings_closeTab"),
      group: workspace,
      run: actions.closeTab,
    },
    {
      id: "sidebarSearch",
      title: t("settings_sidebarSearch"),
      group: workspace,
      run: actions.sidebarSearch,
    },
    {
      id: "locateCurrentFile",
      title: t("settings_locateCurrentFile"),
      group: workspace,
      run: actions.locateCurrentFile,
    },
  ];

  const editorItems: PaletteCommand[] = [
    {
      id: "toggleBold",
      title: t("commandPalette_bold"),
      group: editor,
      keywords: "bold 粗体",
      shortcut: "Mod+B",
      run: () => runEditorCommand(markdownCommands.toggleBold, showNeedEditor),
    },
    {
      id: "toggleItalic",
      title: t("commandPalette_italic"),
      group: editor,
      keywords: "italic 斜体",
      shortcut: "Mod+I",
      run: () =>
        runEditorCommand(markdownCommands.toggleItalic, showNeedEditor),
    },
    {
      id: "insertLink",
      title: t("commandPalette_insertLink"),
      group: editor,
      keywords: "link 链接",
      shortcut: "Mod+K",
      run: () => runEditorCommand(markdownCommands.insertLink, showNeedEditor),
    },
    {
      id: "insertCodeBlock",
      title: t("commandPalette_insertCodeBlock"),
      group: editor,
      keywords: "code fence",
      shortcut: "Mod+Shift+K",
      run: () =>
        runEditorCommand(markdownCommands.insertCodeBlock, showNeedEditor),
    },
    {
      id: "toggleUnorderedList",
      title: t("commandPalette_bulletList"),
      group: editor,
      keywords: "list ul",
      run: () =>
        runEditorCommand(markdownCommands.toggleUnorderedList, showNeedEditor),
    },
    {
      id: "toggleOrderedList",
      title: t("commandPalette_numberedList"),
      group: editor,
      keywords: "list ol",
      run: () =>
        runEditorCommand(markdownCommands.toggleOrderedList, showNeedEditor),
    },
    {
      id: "toggleBlockquote",
      title: t("commandPalette_quote"),
      group: editor,
      keywords: "blockquote",
      run: () =>
        runEditorCommand(markdownCommands.toggleBlockquote, showNeedEditor),
    },
    {
      id: "cycleHeading",
      title: t("commandPalette_heading"),
      group: editor,
      keywords: "heading h1",
      run: () =>
        runEditorCommand(markdownCommands.cycleHeading, showNeedEditor),
    },
  ];

  const tableItems: PaletteCommand[] = [
    {
      id: "insertTable",
      title: t("table_insert"),
      group: table,
      keywords: "gfm html paste excel / 表格 3x3 slash",
      shortcut: "Mod+Shift+T",
      run: () => {
        const view = getActiveEditorView();
        if (!view) {
          showNeedEditor();
          return;
        }
        view.focus();
        openTableInsertPicker(view);
      },
    },
    {
      id: "formatTable",
      title: t("table_format"),
      group: table,
      keywords: "align columns",
      run: () => runEditorCommand(markdownCommands.formatTable, showNeedEditor),
    },
    {
      id: "insertTableRowBelow",
      title: t("table_insertRowBelow"),
      group: table,
      run: () =>
        runEditorCommand(markdownCommands.insertTableRowBelow, showNeedEditor),
    },
    {
      id: "insertTableRowAbove",
      title: t("table_insertRowAbove"),
      group: table,
      run: () =>
        runEditorCommand(markdownCommands.insertTableRowAbove, showNeedEditor),
    },
    {
      id: "insertTableColumnLeft",
      title: t("table_insertColumnLeft"),
      group: table,
      run: () =>
        runEditorCommand(
          markdownCommands.insertTableColumnLeft,
          showNeedEditor,
        ),
    },
    {
      id: "insertTableColumnRight",
      title: t("table_insertColumnRight"),
      group: table,
      run: () =>
        runEditorCommand(
          markdownCommands.insertTableColumnRight,
          showNeedEditor,
        ),
    },
    {
      id: "deleteTableRow",
      title: t("table_deleteRow"),
      group: table,
      run: () =>
        runEditorCommand(markdownCommands.deleteTableRow, showNeedEditor),
    },
    {
      id: "deleteTableColumn",
      title: t("table_deleteColumn"),
      group: table,
      run: () =>
        runEditorCommand(markdownCommands.deleteTableColumn, showNeedEditor),
    },
    {
      id: "alignTableColumnLeft",
      title: t("table_alignLeft"),
      group: table,
      run: () =>
        runEditorCommand(markdownCommands.alignTableColumnLeft, showNeedEditor),
    },
    {
      id: "alignTableColumnCenter",
      title: t("table_alignCenter"),
      group: table,
      run: () =>
        runEditorCommand(
          markdownCommands.alignTableColumnCenter,
          showNeedEditor,
        ),
    },
    {
      id: "alignTableColumnRight",
      title: t("table_alignRight"),
      group: table,
      run: () =>
        runEditorCommand(
          markdownCommands.alignTableColumnRight,
          showNeedEditor,
        ),
    },
  ];

  const publishItems: PaletteCommand[] = [
    {
      id: "askVault",
      title: t("commandPalette_askVault"),
      group: publish,
      keywords: "rag retrieve",
      run: actions.askVault,
    },
    {
      id: "publish",
      title: t("publish_targetTitle"),
      group: publish,
      keywords: "wechat blog 微信 博客",
      run: actions.publish,
    },
    {
      id: "exportPdf",
      title: t("toolbar_exportPdf"),
      group: publish,
      shortcut: formatShortcutForDisplay(shortcuts.exportPdf),
      run: actions.exportPdf,
    },
    {
      id: "exportHtml",
      title: t("toolbar_exportHtml"),
      group: publish,
      run: actions.exportHtml,
    },
    {
      id: "shareLongImage",
      title: t("toolbar_shareLongImage"),
      group: publish,
      run: actions.shareLongImage,
    },
  ];

  return [...workspaceItems, ...editorItems, ...tableItems, ...publishItems];
}
