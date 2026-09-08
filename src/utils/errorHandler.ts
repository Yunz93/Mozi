import { useAppStore } from "../store/appStore";
import type { AppLanguage } from "../types";
import { localizeKnownError, t } from "./i18n";

/**
 * Error codes for file system operations
 */
export type FileSystemErrorCode =
  | "FILE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "DISK_FULL"
  | "INVALID_PATH"
  | "FILE_EXISTS"
  | "DIRECTORY_NOT_EMPTY"
  | "UNKNOWN";

/**
 * Custom error class for file system operations
 */
export class FileSystemError extends Error {
  public readonly code: FileSystemErrorCode;
  public readonly path?: string;

  constructor(
    message: string,
    code: FileSystemErrorCode = "UNKNOWN",
    path?: string,
  ) {
    super(message);
    this.name = "FileSystemError";
    this.code = code;
    this.path = path;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileSystemError);
    }
  }

  /**
   * Create a user-friendly error message
   */
  toUserMessage(): string {
    switch (this.code) {
      case "FILE_NOT_FOUND":
        return `The file "${this.path}" was not found.`;
      case "PERMISSION_DENIED":
        return `Permission denied. Please check file permissions.`;
      case "DISK_FULL":
        return "Disk is full. Please free up some space.";
      case "INVALID_PATH":
        return `Invalid path: "${this.path}"`;
      case "FILE_EXISTS":
        return `A file with this name already exists.`;
      case "DIRECTORY_NOT_EMPTY":
        return "Cannot delete directory. It is not empty.";
      default:
        return this.message;
    }
  }
}

/**
 * Type guard to check if an error is a FileSystemError
 */
export function isFileSystemError(error: unknown): error is FileSystemError {
  return error instanceof FileSystemError;
}

/**
 * Wrap an async operation with error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Re-throw if already a FileSystemError
    if (isFileSystemError(error)) {
      throw error;
    }

    // Convert unknown errors to FileSystemError
    const message = error instanceof Error ? error.message : "Unknown error";

    // Detect specific error types from message
    if (message.includes("permission") || message.includes("denied")) {
      throw new FileSystemError(
        `${context}: Permission denied`,
        "PERMISSION_DENIED",
      );
    }

    if (message.includes("not found") || message.includes("no such file")) {
      throw new FileSystemError(`${context}: File not found`, "FILE_NOT_FOUND");
    }

    if (message.includes("disk full") || message.includes("no space left")) {
      throw new FileSystemError(`${context}: Disk full`, "DISK_FULL");
    }

    if (message.includes("invalid")) {
      throw new FileSystemError(`${context}: Invalid path`, "INVALID_PATH");
    }

    // Default to unknown error
    throw new FileSystemError(`${context}: ${message}`, "UNKNOWN");
  }
}

const INVOKE_ERROR_KEYS = [
  "message",
  "error",
  "errmsg",
  "payload",
  "data",
] as const;

function isBlankOrObjectString(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || trimmed === "[object Object]";
}

/** Normalize invoke / DOM / Error values into a readable message. */
export function getErrorMessage(error: unknown): string {
  return readErrorMessage(error, 0);
}

function readErrorMessage(error: unknown, depth: number): string {
  if (depth > 4 || error == null) {
    return "";
  }
  if (typeof error === "string") {
    return isBlankOrObjectString(error) ? "" : error.trim();
  }
  if (typeof ErrorEvent !== "undefined" && error instanceof ErrorEvent) {
    return (
      readErrorMessage(error.error, depth + 1) ||
      (isBlankOrObjectString(error.message) ? "" : error.message.trim())
    );
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (!isBlankOrObjectString(message)) {
      return message;
    }
    if ("cause" in error) {
      return readErrorMessage(error.cause, depth + 1);
    }
    return "";
  }
  if (typeof error !== "object") {
    return "";
  }

  const record = error as Record<string, unknown>;
  if (record.errcode != null && String(record.errcode).trim()) {
    const errmsg =
      typeof record.errmsg === "string" ? record.errmsg.trim() : "";
    return errmsg
      ? `WeChat API error ${record.errcode}: ${errmsg}`
      : `WeChat API error ${record.errcode}`;
  }

  for (const key of INVOKE_ERROR_KEYS) {
    if (!(key in record)) continue;
    const nested = readErrorMessage(record[key], depth + 1);
    if (nested) return nested;
  }

  return "";
}

const RESOURCE_ERROR_TAGS = /^(IMG|VIDEO|AUDIO|SOURCE|LINK|IFRAME)$/i;

/** 预览图、样式等资源加载失败不应当成应用崩溃。 */
export function isIgnorableWindowErrorEvent(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  if (RESOURCE_ERROR_TAGS.test(target.tagName)) {
    return true;
  }
  // Failed <script src> loads, not executed script exceptions.
  if (target.tagName === "SCRIPT") {
    return !(event instanceof ErrorEvent && event.error);
  }
  return false;
}

/** Prefer a mapped WeChat/API toast over the generic ErrorBoundary copy. */
export function userFacingRuntimeErrorMessage(
  error: unknown,
  language: AppLanguage,
): string {
  const raw = getErrorMessage(error);
  if (!raw) {
    return t(language, "errorBoundary_fallbackMessage");
  }
  const localized = localizeKnownError(language, raw);
  if (localized !== raw) {
    return localized;
  }
  return t(language, "errorBoundary_fallbackMessage");
}

/** 顶层未捕获错误：尽量提示用户，store 未就绪时只打日志。 */
export function reportUnhandledRuntimeError(
  error: unknown,
  source = "runtime",
): void {
  console.error(`[${source}]`, error);
  try {
    const language = useAppStore.getState().settings.language;
    useAppStore
      .getState()
      .showNotification(
        userFacingRuntimeErrorMessage(error, language),
        "error",
      );
  } catch {
    // store / i18n 可能尚未就绪
  }
}

/** Create an error handler for async operations. */
export function createErrorHandler(context: string) {
  return {
    withErrorHandling: <T>(operation: () => Promise<T>): Promise<T> =>
      withErrorHandling(operation, context),

    safeExecute: async <T>(
      operation: () => Promise<T>,
      fallback?: T,
    ): Promise<T | undefined> => {
      try {
        return await operation();
      } catch (error) {
        console.error(`[${context}] Error:`, error);
        return fallback;
      }
    },
  };
}
