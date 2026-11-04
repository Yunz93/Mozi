import { ViewMode } from "../types";

/**
 * Layout configuration constants
 * Centralized management of all layout-related magic numbers
 */

export const LAYOUT = {
  /** Sidebar dimensions and constraints */
  SIDEBAR: {
    DEFAULT_WIDTH: 200,
    MIN_WIDTH: 200,
    MAX_WIDTH: 420,
    RESPONSIVE_MIN_WIDTH: 160,
  },

  /** Outline panel dimensions and constraints */
  OUTLINE: {
    DEFAULT_WIDTH: 240,
    MIN_WIDTH: 180,
    MAX_WIDTH: 360,
  },

  /** Ask Vault docked module (right column) */
  ASK_VAULT: {
    DEFAULT_WIDTH: 400,
    MIN_WIDTH: 320,
    MAX_WIDTH: 560,
  },

  /** Minimum workspace widths for different view modes */
  WORKSPACE: {
    // 单栏已支持紧凑布局；宽屏阅读宽度不能作为侧边栏拖拽的硬性预留。
    SINGLE_VIEW_MIN: 360,
    SPLIT_MIN: 920,
    WITH_OUTLINE: {
      EDITOR: 620,
      PREVIEW: 620,
      SPLIT: 720,
    },
  },

  /** Gap sizes between panels */
  GAP: {
    OUTLINE_PANEL: 32,
    SHELL_EDGE: 24,
  },

  /** Split pane constraints */
  SPLIT_PANE: {
    MIN_WIDTH: 360,
  },

  /** Editor settings */
  EDITOR: {
    LINE_HEIGHT: 1.95,
  },

  /** Scroll sync thresholds */
  SCROLL: {
    SYNC_THRESHOLD: 5,
    EMIT_THRESHOLD: 0.001,
  },

  /** Heading scroll animation */
  HEADING_SCROLL: {
    RETRY_DELAYS_MS: [48, 140],
    ALIGN_TOP_RATIO: 0.18,
  },

  /** Settings modal dimensions and constraints */
  SETTINGS_MODAL: {
    DEFAULT_WIDTH: 960,
    DEFAULT_HEIGHT: 720,
    MIN_WIDTH: 720,
    MAX_WIDTH: 1280,
    MIN_HEIGHT: 480,
    MAX_HEIGHT: 920,
    NAV_DEFAULT_WIDTH: 224,
    NAV_MIN_WIDTH: 160,
    NAV_MAX_WIDTH: 320,
    METADATA_KEY_DEFAULT_WIDTH: 120,
    METADATA_KEY_MIN_WIDTH: 88,
    METADATA_KEY_MAX_WIDTH: 220,
    METADATA_VALUE_DEFAULT_WIDTH: 180,
    METADATA_VALUE_MIN_WIDTH: 120,
    METADATA_VALUE_MAX_WIDTH: 360,
  },

  /** Storage keys for persisted layout settings */
  STORAGE_KEYS: {
    SIDEBAR_WIDTH: "markdown-press.sidebar-width",
    OUTLINE_WIDTH: "markdown-press.outline-width",
    ASK_VAULT_WIDTH: "markdown-press.ask-vault-width",
    SETTINGS_MODAL_WIDTH: "markdown-press.settings-modal-width",
    SETTINGS_MODAL_HEIGHT: "markdown-press.settings-modal-height",
    SETTINGS_NAV_WIDTH: "markdown-press.settings-nav-width",
    SETTINGS_METADATA_KEY_WIDTH: "markdown-press.settings-metadata-key-width",
    SETTINGS_METADATA_VALUE_WIDTH:
      "markdown-press.settings-metadata-value-width",
  },
} as const;

/**
 * Helper function to clamp a value within min/max bounds
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Get stored panel width from localStorage with validation
 */
export function getStoredPanelWidth(
  storageKey: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof window === "undefined") return fallback;

  const rawValue = window.localStorage.getItem(storageKey);
  const parsedValue = rawValue ? Number(rawValue) : Number.NaN;

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return clamp(parsedValue, min, max);
}

/**
 * Calculate minimum workspace width based on view mode
 */
export function getMinimumWorkspaceWidth(_viewMode: ViewMode): number {
  return LAYOUT.WORKSPACE.SINGLE_VIEW_MIN;
}

/**
 * Calculate minimum workspace width with outline panel
 */
export function getMinimumWorkspaceWidthWithOutline(
  viewMode: ViewMode,
): number {
  if (viewMode === ViewMode.PREVIEW) {
    return LAYOUT.WORKSPACE.WITH_OUTLINE.PREVIEW;
  }

  return LAYOUT.WORKSPACE.WITH_OUTLINE.EDITOR;
}
