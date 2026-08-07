import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type TauriWindowConfig = {
  label?: string;
  title?: string;
  titleBarStyle?: string;
  hiddenTitle?: boolean;
  devtools?: boolean;
  [key: string]: unknown;
};

type TauriConfig = {
  productName?: string;
  app?: {
    windows?: TauriWindowConfig[];
    security?: Record<string, unknown>;
  };
  build?: Record<string, unknown>;
  bundle?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
};

type TauriCapabilityConfig = {
  windows?: string[];
};

const MAIN_WINDOW_CHROME_KEYS = [
  "label",
  "title",
  "titleBarStyle",
  "hiddenTitle",
  "theme",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "resizable",
  "fullscreen",
  "dragDropEnabled",
] as const;

function readTauriConfig(path: string): TauriConfig {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), path), "utf8"),
  ) as TauriConfig;
}

function readTauriCapabilityConfig(path: string): TauriCapabilityConfig {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), path), "utf8"),
  ) as TauriCapabilityConfig;
}

function getMainWindow(config: TauriConfig): TauriWindowConfig | undefined {
  return config.app?.windows?.find(
    (windowConfig) => windowConfig.label === "main",
  );
}

function getMainWindowTitle(config: TauriConfig): string | undefined {
  return getMainWindow(config)?.title;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 模拟 Tauri CLI 的 JSON Merge Patch（RFC 7396）：数组会被整段替换。 */
function mergeTauriConfigs(
  base: TauriConfig,
  overlay: TauriConfig,
): TauriConfig {
  function mergeValue(baseValue: unknown, overlayValue: unknown): unknown {
    if (overlayValue === null) {
      return null;
    }

    if (Array.isArray(overlayValue)) {
      return structuredClone(overlayValue);
    }

    if (isPlainObject(overlayValue)) {
      const nextBase = isPlainObject(baseValue) ? { ...baseValue } : {};
      for (const [key, value] of Object.entries(overlayValue)) {
        nextBase[key] = mergeValue(
          isPlainObject(baseValue) ? baseValue[key] : undefined,
          value,
        );
      }
      return nextBase;
    }

    return overlayValue;
  }

  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "$schema") {
      continue;
    }
    (merged as Record<string, unknown>)[key] = mergeValue(
      (merged as Record<string, unknown>)[key],
      value,
    );
  }

  return merged;
}

function diffConfigPaths(left: unknown, right: unknown, path = ""): string[] {
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right) ? [] : [path];
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].flatMap((key) => {
      const nextPath = path ? `${path}.${key}` : key;
      return diffConfigPaths(left[key], right[key], nextPath);
    });
  }

  return JSON.stringify(left) === JSON.stringify(right) ? [] : [path];
}

describe("Tauri window config", () => {
  it("hides the overlay title text while keeping the product name for the app bundle", () => {
    const config = readTauriConfig("src-tauri/tauri.conf.json");

    expect(config.productName).toBeTruthy();
    expect(getMainWindowTitle(config)).toBe("");
    expect(getMainWindow(config)?.hiddenTitle).toBe(true);
    expect(getMainWindow(config)?.titleBarStyle).toBe("Overlay");
  });

  it("keeps the dev main window title hidden like release", () => {
    const releaseConfig = readTauriConfig("src-tauri/tauri.conf.json");
    const devOverlay = readTauriConfig("src-tauri/tauri.dev.conf.json");
    const mergedDevConfig = mergeTauriConfigs(releaseConfig, devOverlay);

    expect(getMainWindowTitle(mergedDevConfig)).toBe("");
    expect(getMainWindow(mergedDevConfig)?.hiddenTitle).toBe(true);
    expect(getMainWindow(mergedDevConfig)?.titleBarStyle).toBe("Overlay");
  });

  it("keeps dev overlay window chrome aligned with release because arrays are replaced", () => {
    const releaseConfig = readTauriConfig("src-tauri/tauri.conf.json");
    const devOverlay = readTauriConfig("src-tauri/tauri.dev.conf.json");
    const releaseMainWindow = getMainWindow(releaseConfig);
    const devMainWindow = getMainWindow(devOverlay);

    expect(devMainWindow).toBeDefined();
    for (const key of MAIN_WINDOW_CHROME_KEYS) {
      expect(devMainWindow?.[key]).toEqual(releaseMainWindow?.[key]);
    }
    expect(devMainWindow?.devtools).toBe(true);
  });

  it("keeps merged dev config aligned with release except for devtools", () => {
    const releaseConfig = readTauriConfig("src-tauri/tauri.conf.json");
    const devOverlay = readTauriConfig("src-tauri/tauri.dev.conf.json");
    const mergedDevConfig = mergeTauriConfigs(releaseConfig, devOverlay);

    const diffs = diffConfigPaths(releaseConfig, mergedDevConfig).filter(
      Boolean,
    );
    expect(diffs).toEqual(["app.windows"]);
    expect(getMainWindow(releaseConfig)?.devtools).toBe(false);
    expect(getMainWindow(mergedDevConfig)?.devtools).toBe(true);
    expect(getMainWindow(mergedDevConfig)?.hiddenTitle).toBe(true);
    expect(getMainWindow(mergedDevConfig)?.titleBarStyle).toBe("Overlay");
  });

  it("keeps a usable minimum main-window size for dense chrome layouts", () => {
    const config = readTauriConfig("src-tauri/tauri.conf.json");
    const mainWindow = getMainWindow(config);

    expect(mainWindow?.width).toBe(1200);
    expect(mainWindow?.height).toBe(800);
    expect(mainWindow?.minWidth).toBe(960);
    expect(mainWindow?.minHeight).toBe(640);
  });

  it("grants the default desktop permissions to file document windows", () => {
    const capability = readTauriCapabilityConfig(
      "src-tauri/capabilities/default.json",
    );

    expect(capability.windows).toContain("main");
    expect(capability.windows).toContain("file-*");
    expect(capability.windows).toContain("win-*");
  });
});
