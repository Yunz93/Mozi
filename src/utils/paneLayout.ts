export interface PaneLayoutMetrics {
  backdropPaddingX: number;
  backdropPaddingY: number;
  frameMaxWidth: number;
  sheetMaxWidth: number;
  contentPaddingX: number;
  contentPaddingTop: number;
  contentPaddingBottom: number;
  sheetRadius: number;
}

export type PaneDensity = "comfortable" | "compact";

const SMALL_BREAKPOINT = 360;
const MEDIUM_BREAKPOINT = 920;
const LARGE_BREAKPOINT = 1320;

const SMALL_METRICS: PaneLayoutMetrics = {
  backdropPaddingX: 12,
  backdropPaddingY: 14,
  frameMaxWidth: SMALL_BREAKPOINT,
  sheetMaxWidth: SMALL_BREAKPOINT,
  contentPaddingX: 24,
  contentPaddingTop: 34,
  contentPaddingBottom: 46,
  sheetRadius: 22,
};

const MEDIUM_METRICS: PaneLayoutMetrics = {
  backdropPaddingX: 20,
  backdropPaddingY: 22,
  frameMaxWidth: 1080,
  sheetMaxWidth: 920,
  contentPaddingX: 40,
  contentPaddingTop: 44,
  contentPaddingBottom: 60,
  sheetRadius: 26,
};

const LARGE_METRICS: PaneLayoutMetrics = {
  backdropPaddingX: 28,
  backdropPaddingY: 30,
  frameMaxWidth: 1240,
  sheetMaxWidth: 1080,
  contentPaddingX: 56,
  contentPaddingTop: 52,
  contentPaddingBottom: 72,
  sheetRadius: 28,
};

function scale(value: number, multiplier: number): number {
  return value * multiplier;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function interpolateMetrics(
  from: PaneLayoutMetrics,
  to: PaneLayoutMetrics,
  progress: number,
): PaneLayoutMetrics {
  const t = clamp01(progress);

  return {
    backdropPaddingX: interpolate(
      from.backdropPaddingX,
      to.backdropPaddingX,
      t,
    ),
    backdropPaddingY: interpolate(
      from.backdropPaddingY,
      to.backdropPaddingY,
      t,
    ),
    frameMaxWidth: interpolate(from.frameMaxWidth, to.frameMaxWidth, t),
    sheetMaxWidth: interpolate(from.sheetMaxWidth, to.sheetMaxWidth, t),
    contentPaddingX: interpolate(from.contentPaddingX, to.contentPaddingX, t),
    contentPaddingTop: interpolate(
      from.contentPaddingTop,
      to.contentPaddingTop,
      t,
    ),
    contentPaddingBottom: interpolate(
      from.contentPaddingBottom,
      to.contentPaddingBottom,
      t,
    ),
    sheetRadius: interpolate(from.sheetRadius, to.sheetRadius, t),
  };
}

export function getPaneLayoutMetrics(
  width: number,
  density: PaneDensity,
): PaneLayoutMetrics {
  const safeWidth = Math.max(width || 0, SMALL_BREAKPOINT);
  const densityScale = density === "compact" ? 0.82 : 1;

  let metrics: PaneLayoutMetrics = SMALL_METRICS;

  if (safeWidth >= LARGE_BREAKPOINT) {
    metrics = LARGE_METRICS;
  } else if (safeWidth >= MEDIUM_BREAKPOINT) {
    metrics = interpolateMetrics(
      MEDIUM_METRICS,
      LARGE_METRICS,
      (safeWidth - MEDIUM_BREAKPOINT) / (LARGE_BREAKPOINT - MEDIUM_BREAKPOINT),
    );
  } else {
    metrics = interpolateMetrics(
      SMALL_METRICS,
      MEDIUM_METRICS,
      (safeWidth - SMALL_BREAKPOINT) / (MEDIUM_BREAKPOINT - SMALL_BREAKPOINT),
    );
  }

  return {
    backdropPaddingX: scale(metrics.backdropPaddingX, densityScale),
    backdropPaddingY: scale(metrics.backdropPaddingY, densityScale),
    frameMaxWidth: Math.min(metrics.frameMaxWidth, safeWidth),
    sheetMaxWidth: Math.min(metrics.sheetMaxWidth, safeWidth),
    contentPaddingX: scale(metrics.contentPaddingX, densityScale),
    contentPaddingTop: scale(metrics.contentPaddingTop, densityScale),
    contentPaddingBottom: scale(metrics.contentPaddingBottom, densityScale),
    sheetRadius: scale(metrics.sheetRadius, density === "compact" ? 0.92 : 1),
  };
}

export function scalePaneLayoutMetrics(
  metrics: PaneLayoutMetrics,
  scaleFactor: number,
): PaneLayoutMetrics {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    return metrics;
  }

  const scaleValue = (value: number) => value * scaleFactor;

  return {
    backdropPaddingX: scaleValue(metrics.backdropPaddingX),
    backdropPaddingY: scaleValue(metrics.backdropPaddingY),
    frameMaxWidth: scaleValue(metrics.frameMaxWidth),
    sheetMaxWidth: scaleValue(metrics.sheetMaxWidth),
    contentPaddingX: scaleValue(metrics.contentPaddingX),
    contentPaddingTop: scaleValue(metrics.contentPaddingTop),
    contentPaddingBottom: scaleValue(metrics.contentPaddingBottom),
    sheetRadius: scaleValue(metrics.sheetRadius),
  };
}
