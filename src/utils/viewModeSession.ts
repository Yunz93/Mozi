import { ViewMode } from "../types";
import { normalizeSessionViewMode } from "./viewMode";

export interface PreviewOnlyViewModeTransitionInput {
  wasPreviewOnly: boolean;
  isPreviewOnly: boolean;
  currentViewMode: ViewMode;
  viewModeBeforePreviewOnly: ViewMode | null;
}

export interface PreviewOnlyViewModeTransitionResult {
  nextViewMode?: ViewMode;
  nextViewModeBeforePreviewOnly?: ViewMode | null;
}

/**
 * Keep the user's chosen edit/split/reading mode sticky across file switches.
 * Preview-only assets (PDF/image/HTML) temporarily force PREVIEW, then restore.
 */
export function resolvePreviewOnlyViewModeTransition(
  input: PreviewOnlyViewModeTransitionInput,
): PreviewOnlyViewModeTransitionResult {
  const {
    wasPreviewOnly,
    isPreviewOnly,
    currentViewMode,
    viewModeBeforePreviewOnly,
  } = input;

  if (isPreviewOnly && !wasPreviewOnly) {
    return {
      nextViewMode: ViewMode.PREVIEW,
      nextViewModeBeforePreviewOnly: normalizeSessionViewMode(currentViewMode),
    };
  }

  if (!isPreviewOnly && wasPreviewOnly) {
    return {
      nextViewMode: normalizeSessionViewMode(
        viewModeBeforePreviewOnly ?? currentViewMode,
      ),
      nextViewModeBeforePreviewOnly: null,
    };
  }

  if (isPreviewOnly && currentViewMode !== ViewMode.PREVIEW) {
    return {
      nextViewMode: ViewMode.PREVIEW,
      nextViewModeBeforePreviewOnly: normalizeSessionViewMode(
        viewModeBeforePreviewOnly ?? currentViewMode,
      ),
    };
  }

  return {};
}
