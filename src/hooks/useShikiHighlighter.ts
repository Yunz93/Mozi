import { useEffect, useMemo, useState } from "react";
import type {
  DynamicImportLanguageRegistration,
  LanguageInput,
} from "shiki/core";
import { extractMarkdownFenceLanguages } from "../utils/shikiLanguages";
import { MARKDOWN_PRESS_SHIKI_THEMES } from "../utils/shikiTheme";
import { isTauriEnvironment, waitForTauri } from "../types/filesystem";
import { useAppStore } from "../store/appStore";

/** Shiki highlighter interface for syntax highlighting */
export interface ShikiHighlighter {
  codeToHtml: (
    code: string,
    options: { lang: string; theme: string },
  ) => string;
  getLoadedLanguages?: () => string[];
  loadLanguage?: (...langs: LanguageInput[]) => Promise<void>;
  supportsLanguage?: (lang: string) => boolean;
  /** Bumps when lazy-loaded languages change; use in markdown render cache keys. */
  __revision?: number;
}

let cachedHighlighter: ShikiHighlighter | null = null;
let cachedHighlighterPromise: Promise<ShikiHighlighter | null> | null = null;

async function persistShikiDiagnostics(message: string, error?: unknown) {
  // Don't trust environment detection in release — try best-effort anyway.
  if (isTauriEnvironment()) {
    const ready = await waitForTauri(2500);
    if (!ready) return;
  }

  const payload = (() => {
    const now = new Date().toISOString();
    const details =
      error instanceof Error
        ? `${error.message}\n${error.stack ?? ""}`.trim()
        : String(error ?? "").trim();
    return `[${now}] ${message}\n${details}\n\n`;
  })();

  try {
    const [{ writeTextFile, mkdir }, { appDataDir, join }] = await Promise.all([
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]);

    const dir = await appDataDir();
    const folder = await join(dir, "MarkdownPress");
    const file = await join(folder, "shiki-diagnostics.log");
    await mkdir(folder, { recursive: true });
    await writeTextFile(file, payload, { append: true });

    if (!(globalThis as any).__mp_shiki_diag_toast_shown) {
      (globalThis as any).__mp_shiki_diag_toast_shown = true;
      useAppStore
        .getState()
        .showNotification(`Shiki 初始化失败，已写入日志：${file}`, "error");
    }
  } catch {
    // ignore
  }
}

function getBundledLanguageLoader(
  bundledLanguages: Record<string, unknown>,
  lang: string,
): LanguageInput | null {
  const loader = bundledLanguages[lang];
  return typeof loader === "function"
    ? (loader as DynamicImportLanguageRegistration)
    : null;
}

/**
 * Resolve each language loader independently so one failing dynamic-import chunk
 * (e.g. blocked or 404 under the Tauri asset protocol in a packaged build) does not
 * abort the whole highlighter creation and leave the app with no syntax highlighting.
 */
async function resolveInitialLanguages(
  loaders: LanguageInput[],
): Promise<LanguageInput[]> {
  const settled = await Promise.allSettled(
    loaders.map(async (loader) =>
      typeof loader === "function" ? await loader() : loader,
    ),
  );

  const resolved: LanguageInput[] = [];
  let failedCount = 0;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      const value = result.value as unknown;
      const registration =
        value && typeof value === "object" && "default" in value
          ? (value as { default: LanguageInput }).default
          : (value as LanguageInput);
      resolved.push(registration);
    } else {
      failedCount += 1;
    }
  }

  if (failedCount > 0) {
    console.warn(
      `Skipping ${failedCount} Shiki language chunk(s) that failed to load.`,
    );
    void persistShikiDiagnostics(
      `Failed to load ${failedCount} Shiki language chunk(s)`,
    );
  }

  return resolved;
}

export async function createShikiHighlighter(
  languages: readonly string[] = [],
): Promise<ShikiHighlighter | null> {
  try {
    const [
      { createHighlighterCore },
      { bundledLanguages },
      { createJavaScriptRegexEngine },
    ] = await Promise.all([
      import("shiki/core"),
      import("shiki/langs"),
      import("shiki/engine/javascript"),
    ]);

    const bundledLanguageIds = new Set(Object.keys(bundledLanguages ?? {}));
    const requestedLangs = [...new Set(languages)];
    const supportedLangs = requestedLangs.filter((lang) =>
      bundledLanguageIds.has(lang),
    );
    const initialLanguageLoaders = supportedLangs
      .map((lang) => getBundledLanguageLoader(bundledLanguages, lang))
      .filter((loader): loader is NonNullable<typeof loader> =>
        Boolean(loader),
      );

    if (supportedLangs.length !== requestedLangs.length) {
      const unsupportedLangs = requestedLangs.filter(
        (lang) => !bundledLanguageIds.has(lang),
      );
      console.warn(
        "Skipping unsupported Shiki bundle languages:",
        unsupportedLangs,
      );
    }

    const resolvedLanguages = await resolveInitialLanguages(
      initialLanguageLoaders,
    );

    const highlighter = await createHighlighterCore({
      themes: MARKDOWN_PRESS_SHIKI_THEMES,
      langs: resolvedLanguages,
      // `forgiving: true` makes the JS regex engine skip TextMate grammar patterns it
      // cannot translate to a native RegExp instead of throwing. WKWebView (JavaScriptCore)
      // supports fewer RegExp features than the Chromium-based dev runtime, so grammars that
      // compile in `npm run dev` can throw in the packaged release. Without this flag a single
      // unsupported pattern aborts highlighter creation and disables highlighting entirely.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });

    return {
      codeToHtml: highlighter.codeToHtml.bind(highlighter),
      getLoadedLanguages: highlighter.getLoadedLanguages?.bind(highlighter),
      loadLanguage: highlighter.loadLanguage?.bind(
        highlighter,
      ) as ShikiHighlighter["loadLanguage"],
      supportsLanguage: (lang: string) => bundledLanguageIds.has(lang),
    };
  } catch (error) {
    console.error("Failed to initialize Shiki highlighter:", error);
    void persistShikiDiagnostics(
      "Failed to initialize Shiki highlighter",
      error,
    );
    return null;
  }
}

function ensureHighlighter(
  languages: string[],
): Promise<ShikiHighlighter | null> {
  if (cachedHighlighter) {
    return Promise.resolve(cachedHighlighter);
  }

  if (!cachedHighlighterPromise) {
    cachedHighlighterPromise = createShikiHighlighter(languages)
      .then((highlighter) => {
        cachedHighlighter = highlighter;
        return highlighter;
      })
      .catch((error) => {
        console.error("Failed to load shiki:", error);
        void persistShikiDiagnostics("Failed to load shiki", error);
        cachedHighlighterPromise = null;
        return null;
      });
  }

  return cachedHighlighterPromise;
}

/**
 * Lazily loads the Shiki syntax highlighter.
 * Extracted from App.tsx to keep the component clean.
 * Uses singleton pattern to avoid re-creating in build mode.
 */
export function useShikiHighlighter(markdownContent = "") {
  // Use a stable dependency: typing within the same fence must not repeatedly
  // cancel or restart language imports. Plain/diagram notes need no engine.
  const languageKey = useMemo(
    () => extractMarkdownFenceLanguages(markdownContent).join("\0"),
    [markdownContent],
  );
  const [highlighterInstance, setHighlighterInstance] =
    useState<ShikiHighlighter | null>(cachedHighlighter);
  const [highlighterRevision, setHighlighterRevision] = useState(0);

  useEffect(() => {
    if (!languageKey) return;
    let cancelled = false;
    void ensureHighlighter(languageKey.split("\0")).then((highlighter) => {
      if (!highlighter || cancelled) return;
      setHighlighterInstance(highlighter);
      setHighlighterRevision((prev) => prev + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [languageKey]);

  useEffect(() => {
    if (!highlighterInstance?.loadLanguage || !languageKey) return;

    const supportsLanguage =
      highlighterInstance.supportsLanguage ?? (() => true);
    const loadedLanguages = new Set(
      highlighterInstance.getLoadedLanguages?.() ?? [],
    );
    let cancelled = false;
    const languages = languageKey.split("\0");
    const unsupportedLanguages = languages.filter(
      (lang) => !supportsLanguage(lang),
    );

    if (unsupportedLanguages.length > 0) {
      console.warn(
        "Skipping Shiki languages not available in this bundle:",
        unsupportedLanguages,
      );
    }

    const missingLanguages = languages.filter(
      (lang) => !loadedLanguages.has(lang) && supportsLanguage(lang),
    );

    if (missingLanguages.length > 0) {
      void Promise.all([import("shiki/langs")])
        .then(([{ bundledLanguages }]) => {
          if (cancelled) return;

          const languageLoaders = missingLanguages
            .map((lang) => getBundledLanguageLoader(bundledLanguages, lang))
            .filter((loader): loader is NonNullable<typeof loader> =>
              Boolean(loader),
            );

          if (languageLoaders.length === 0) {
            return;
          }

          return highlighterInstance.loadLanguage?.(...languageLoaders);
        })
        .then(() => {
          if (!cancelled) {
            setHighlighterRevision((prev) => prev + 1);
          }
        })
        .catch((error) => {
          console.error(
            "Failed to load additional Shiki languages:",
            missingLanguages,
            error,
          );
        });
    }

    return () => {
      cancelled = true;
    };
  }, [highlighterInstance, languageKey]);

  const highlighter = useMemo(() => {
    if (!highlighterInstance) {
      return null;
    }

    return {
      codeToHtml: highlighterInstance.codeToHtml.bind(highlighterInstance),
      getLoadedLanguages:
        highlighterInstance.getLoadedLanguages?.bind(highlighterInstance),
      loadLanguage: highlighterInstance.loadLanguage?.bind(highlighterInstance),
      supportsLanguage:
        highlighterInstance.supportsLanguage?.bind(highlighterInstance),
      __revision: highlighterRevision,
    };
  }, [highlighterInstance, highlighterRevision]);

  return { highlighter };
}
