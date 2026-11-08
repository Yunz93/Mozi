import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../types/filesystem";
import { normalizeBlogRepoUrl } from "../utils/blogRepo";

export type BlogConnectionError =
  | "invalidRepo"
  | "missingToken"
  | "invalidToken"
  | "forbidden"
  | "rateLimited"
  | "notFound"
  | "emptyRepository"
  | "archived"
  | "disabled"
  | "network"
  | "timeout"
  | "unexpected"
  | "desktopOnly";

export interface BlogConnectionResult {
  status: "passed" | "warning" | "failed";
  repository: string | null;
  branch: string | null;
  errorKind: BlogConnectionError | null;
}

export async function checkSimpleBlogConnection(
  repoUrl: string,
  token: string,
): Promise<BlogConnectionResult> {
  const normalized = normalizeBlogRepoUrl(repoUrl);
  const errorKind = !normalized
    ? "invalidRepo"
    : !token.trim()
      ? "missingToken"
      : !isTauriEnvironment()
        ? "desktopOnly"
        : null;
  if (errorKind) {
    return { status: "failed", repository: null, branch: null, errorKind };
  }
  try {
    return await invoke<BlogConnectionResult>("check_simple_blog_connection", {
      request: { blogRepoUrl: normalized, blogGithubToken: token.trim() },
    });
  } catch {
    // IPC 错误不直接展示，避免把底层请求信息带入设置页。
    return {
      status: "failed",
      repository: null,
      branch: null,
      errorKind: "unexpected",
    };
  }
}
