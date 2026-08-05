/**
 * Live Preview table structure context menu (add/delete rows & columns).
 */

import type { EditorView } from "@codemirror/view";
import { useAppStore } from "../../../store/appStore";
import { t, type TranslationKey } from "../../../utils/i18n";

export type LiveTableStructureOp =
  | "insertRowAbove"
  | "insertRowBelow"
  | "deleteRow"
  | "insertColumnLeft"
  | "insertColumnRight"
  | "deleteColumn";

export interface LiveTableMenuTarget {
  view: EditorView;
  tableFrom: number;
  logicalRow: number;
  col: number;
  readValue: () => string;
  canDeleteColumn: boolean;
  apply: (op: LiveTableStructureOp, value: string) => void;
}

type MenuItem =
  | {
      type: "action";
      op: LiveTableStructureOp;
      labelKey: TranslationKey;
      disabled?: boolean;
    }
  | { type: "sep" };

const MENU_ITEMS: MenuItem[] = [
  { type: "action", op: "insertRowAbove", labelKey: "table_insertRowAbove" },
  { type: "action", op: "insertRowBelow", labelKey: "table_insertRowBelow" },
  { type: "action", op: "deleteRow", labelKey: "table_deleteRow" },
  { type: "sep" },
  {
    type: "action",
    op: "insertColumnLeft",
    labelKey: "table_insertColumnLeft",
  },
  {
    type: "action",
    op: "insertColumnRight",
    labelKey: "table_insertColumnRight",
  },
  { type: "action", op: "deleteColumn", labelKey: "table_deleteColumn" },
];

let openMenu: HTMLElement | null = null;
let removeListeners: (() => void) | null = null;

export function closeLiveTableContextMenu(): void {
  removeListeners?.();
  removeListeners = null;
  openMenu?.remove();
  openMenu = null;
}

function shortcutHint(op: LiveTableStructureOp, isMac: boolean): string {
  const mod = isMac ? "⌘" : "Ctrl";
  const alt = isMac ? "⌥" : "Alt";
  switch (op) {
    case "insertRowBelow":
      return `${mod}+Shift+Enter`;
    case "insertRowAbove":
      return `${alt}+Shift+Enter`;
    case "insertColumnLeft":
      return `${alt}+${mod}+←`;
    case "insertColumnRight":
      return `${alt}+${mod}+→`;
    case "deleteRow":
      return `${mod}+Shift+⌫`;
    case "deleteColumn":
      return `${alt}+${mod}+⌫`;
    default:
      return "";
  }
}

export function openLiveTableContextMenu(
  event: MouseEvent,
  target: LiveTableMenuTarget,
): void {
  event.preventDefault();
  event.stopPropagation();
  closeLiveTableContextMenu();

  const language = useAppStore.getState().settings.language;
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

  const menu = document.createElement("div");
  menu.className = "cm-live-preview-table-menu";
  menu.setAttribute("role", "menu");

  for (const item of MENU_ITEMS) {
    if (item.type === "sep") {
      const sep = document.createElement("div");
      sep.className = "cm-live-preview-table-menu-sep";
      menu.appendChild(sep);
      continue;
    }

    const disabled =
      item.disabled || (item.op === "deleteColumn" && !target.canDeleteColumn);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-live-preview-table-menu-item";
    btn.setAttribute("role", "menuitem");
    btn.disabled = disabled;

    const label = document.createElement("span");
    label.textContent = t(language, item.labelKey);
    btn.appendChild(label);

    const hint = shortcutHint(item.op, isMac);
    if (hint) {
      const kbd = document.createElement("span");
      kbd.className = "cm-live-preview-table-menu-kbd";
      kbd.textContent = hint;
      btn.appendChild(kbd);
    }

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      const value = target.readValue();
      closeLiveTableContextMenu();
      target.apply(item.op, value);
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  openMenu = menu;

  const pad = 8;
  const rect = menu.getBoundingClientRect();
  let left = event.clientX;
  let top = event.clientY;
  if (left + rect.width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - rect.width - pad);
  }
  if (top + rect.height > window.innerHeight - pad) {
    top = Math.max(pad, window.innerHeight - rect.height - pad);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onPointerDown = (e: Event) => {
    if (menu.contains(e.target as Node)) return;
    closeLiveTableContextMenu();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeLiveTableContextMenu();
    }
  };
  const onScroll = () => closeLiveTableContextMenu();

  window.addEventListener("mousedown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);
  removeListeners = () => {
    window.removeEventListener("mousedown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);
  };
}
