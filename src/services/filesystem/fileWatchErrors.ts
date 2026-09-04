/**
 * 判断文件监听读盘失败是否表示「文件已不存在」。
 * 不能只靠英文文案：中文 Windows 仍会带 `os error 2` / `os error 3`。
 */
export function isFileNotFoundError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  const lower = message.toLowerCase();

  if (
    lower.includes("not found") ||
    lower.includes("no such file") ||
    lower.includes("cannot find the path") ||
    (message.includes("路径") && message.includes("找不到"))
  ) {
    return true;
  }

  // ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND；中文系统文案也带 os error 码。
  if (/\bos error 2\b/i.test(message) || /\bos error 3\b/i.test(message)) {
    return true;
  }

  if (error && typeof error === "object") {
    const code =
      "code" in error ? String((error as { code?: unknown }).code) : "";
    if (
      code === "NotFound" ||
      code === "ENOENT" ||
      code === "ERROR_FILE_NOT_FOUND" ||
      code === "ERROR_PATH_NOT_FOUND"
    ) {
      return true;
    }
    const name =
      "name" in error ? String((error as { name?: unknown }).name) : "";
    if (name === "NotFound") {
      return true;
    }
  }

  return false;
}
