export interface BootOpenFileQuery {
  paths: string[];
  /** When true, restore the last knowledge base before opening paths. */
  withVault: boolean;
}

/**
 * OS / system file-browser launches open documents alone.
 * In-app "Open in New Window" sets `withVault=1` so the vault tree is restored.
 */
export function shouldRestoreVaultOnBoot(input: {
  pendingBootPathCount: number;
  withVault: boolean;
}): boolean {
  if (input.pendingBootPathCount <= 0) return true;
  return input.withVault;
}

export function takeBootOpenFileQuery(
  href: string = typeof window === "undefined" ? "" : window.location.href,
  replaceHistory: boolean = typeof window !== "undefined",
): BootOpenFileQuery {
  try {
    if (!href) return { paths: [], withVault: false };
    const url = new URL(href);
    const openFile = url.searchParams.get("openFile")?.trim() ?? "";
    const withVault =
      url.searchParams.get("withVault") === "1" ||
      url.searchParams.get("withVault") === "true";

    if (openFile || url.searchParams.has("withVault")) {
      url.searchParams.delete("openFile");
      url.searchParams.delete("withVault");
      if (replaceHistory && typeof window !== "undefined") {
        window.history.replaceState({}, "", url.toString());
      }
    }

    return {
      paths: openFile ? [openFile] : [],
      withVault,
    };
  } catch {
    return { paths: [], withVault: false };
  }
}

export function buildOpenFileWindowUrl(
  path: string,
  options?: { withVault?: boolean },
): string {
  const params = new URLSearchParams();
  params.set("openFile", path);
  if (options?.withVault) {
    params.set("withVault", "1");
  }
  return `index.html?${params.toString()}`;
}
