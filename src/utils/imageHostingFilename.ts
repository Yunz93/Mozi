/**
 * 图床上传文件名：原名 + 内容哈希，避免同名覆盖远端已有图片。
 */

function fnv1a32(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function sha256Prefix8(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return fnv1a32(bytes);
  }
  try {
    const digest = await subtle.digest("SHA-256", bytes.slice());
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hex.slice(0, 8);
  } catch {
    return fnv1a32(bytes);
  }
}

function splitFilename(name: string): { basename: string; ext: string } {
  const trimmed = name.trim() || "image";
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return { basename: base || "image", ext: "" };
  }
  return { basename: base.slice(0, dot), ext: base.slice(dot + 1) };
}

export async function buildHostedImageFilename(
  name: string,
  bytes: Uint8Array | ArrayBuffer,
): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const shortHash = await sha256Prefix8(buffer);
  const { basename, ext } = splitFilename(name);
  return ext ? `${basename}-${shortHash}.${ext}` : `${basename}-${shortHash}`;
}
