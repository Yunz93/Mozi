export const ENCODING_UNSUPPORTED_CODE = "ENCODING_UNSUPPORTED";

const UTF16LE_BOM = [0xff, 0xfe] as const;
const UTF16BE_BOM = [0xfe, 0xff] as const;

export function createEncodingUnsupportedError(
  path: string,
): Error & { code: string } {
  const error = new Error(
    `${ENCODING_UNSUPPORTED_CODE}: 该文件不是 UTF-8 编码，为避免损坏已禁用保存 (${path})`,
  ) as Error & { code: string };
  error.code = ENCODING_UNSUPPORTED_CODE;
  return error;
}

export function isEncodingUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return String(error).includes(ENCODING_UNSUPPORTED_CODE);
  }
  if (
    "code" in error &&
    (error as { code?: unknown }).code === ENCODING_UNSUPPORTED_CODE
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(ENCODING_UNSUPPORTED_CODE);
}

function tryDecode(
  bytes: Uint8Array,
  encoding: string,
  fatal: boolean,
): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeTextFileBytes(bytes: Uint8Array): {
  text: string;
  isUtf8: boolean;
} {
  const utf8 = tryDecode(bytes, "utf-8", true);
  if (utf8 !== null) {
    // TextDecoder 会丢掉 UTF-8 BOM，补回去以便 captureFileFormat 识别。
    const hasUtf8Bom =
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf;
    const text =
      hasUtf8Bom && !utf8.startsWith("\uFEFF") ? `\uFEFF${utf8}` : utf8;
    return { text, isUtf8: true };
  }

  if (
    bytes.length >= 2 &&
    bytes[0] === UTF16LE_BOM[0] &&
    bytes[1] === UTF16LE_BOM[1]
  ) {
    const text = tryDecode(bytes, "utf-16le", false);
    if (text !== null) {
      return { text, isUtf8: false };
    }
  }

  if (
    bytes.length >= 2 &&
    bytes[0] === UTF16BE_BOM[0] &&
    bytes[1] === UTF16BE_BOM[1]
  ) {
    const text = tryDecode(bytes, "utf-16be", false);
    if (text !== null) {
      return { text, isUtf8: false };
    }
  }

  const gbk =
    tryDecode(bytes, "gbk", true) ?? tryDecode(bytes, "gb18030", true);
  if (gbk !== null) {
    return { text: gbk, isUtf8: false };
  }

  // 非 fatal UTF-8 仅用于界面展示，可能含 U+FFFD。
  return {
    text: tryDecode(bytes, "utf-8", false) ?? "",
    isUtf8: false,
  };
}
