import { useAppStore } from "../store/appStore";
import { t } from "./i18n";

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

/**
 * Create an error handler for async operations
 */
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
      .showNotification(t(language, "errorBoundary_fallbackMessage"), "error");
  } catch {
    // store / i18n 可能尚未就绪
  }
}

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
