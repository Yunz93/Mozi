import { describe, expect, it } from "vitest";
import {
  ENCODING_UNSUPPORTED_CODE,
  createEncodingUnsupportedError,
  decodeTextFileBytes,
  isEncodingUnsupportedError,
} from "./textFileEncoding";

describe("decodeTextFileBytes", () => {
  it("decodes UTF-8 without marking the file", () => {
    const bytes = new TextEncoder().encode("hello 墨知\n");
    expect(decodeTextFileBytes(bytes)).toEqual({
      text: "hello 墨知\n",
      isUtf8: true,
    });
  });

  it("keeps a UTF-8 BOM in the decoded string", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    expect(decodeTextFileBytes(bytes)).toEqual({
      text: "\uFEFFhi",
      isUtf8: true,
    });
  });

  it("decodes UTF-16LE with BOM for display and marks non-UTF-8", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    const decoded = decodeTextFileBytes(bytes);
    expect(decoded.isUtf8).toBe(false);
    expect(decoded.text.replace(/^\uFEFF/, "")).toBe("Hi");
  });

  it("treats invalid UTF-8 bytes as display-only non-UTF-8", () => {
    // GBK「你好」：对 UTF-8 fatal 解码会失败
    const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    const decoded = decodeTextFileBytes(bytes);
    expect(decoded.isUtf8).toBe(false);
    expect(typeof decoded.text).toBe("string");
    expect(decoded.text.length).toBeGreaterThan(0);
  });
});

describe("encoding unsupported error", () => {
  it("exposes ENCODING_UNSUPPORTED for save guards", () => {
    const error = createEncodingUnsupportedError("/tmp/note.md");
    expect(error.code).toBe(ENCODING_UNSUPPORTED_CODE);
    expect(isEncodingUnsupportedError(error)).toBe(true);
    expect(
      isEncodingUnsupportedError(
        new Error("Auto-save failed: ENCODING_UNSUPPORTED: 该文件不是 UTF-8"),
      ),
    ).toBe(true);
    expect(isEncodingUnsupportedError(new Error("permission denied"))).toBe(
      false,
    );
  });
});
