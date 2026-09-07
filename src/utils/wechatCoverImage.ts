import type { AttachmentLocation } from "../types";
import { getFileSystem } from "../types/filesystem";
import { resolveAttachmentTargetDir } from "./attachmentLocation";
import { joinFsPath } from "./pathHelpers";

export function getClipboardImageFile(
  data: DataTransfer | null | undefined,
): File | null {
  if (!data) return null;

  const fromFiles = Array.from(data.files ?? []).find((file) =>
    file.type.startsWith("image/"),
  );
  if (fromFiles) return fromFiles;

  const item = Array.from(data.items ?? []).find((entry) =>
    entry.type.startsWith("image/"),
  );
  return item?.getAsFile() ?? null;
}

export function clipboardHasPlainText(
  data: DataTransfer | null | undefined,
): boolean {
  return Boolean(data?.getData("text/plain")?.trim());
}

export function shouldApplyPastedCoverImage(
  data: DataTransfer | null | undefined,
  target: EventTarget | null,
): boolean {
  const image = getClipboardImageFile(data);
  if (!image) return false;

  const element = target instanceof HTMLElement ? target : null;
  if (element?.closest("[data-wechat-cover-drop]")) {
    return true;
  }

  const inTextField = Boolean(element?.closest("input, textarea"));
  return !inTextField || !clipboardHasPlainText(data);
}

export function getImageFileExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/avif":
      return "avif";
    default:
      return "png";
  }
}

export function buildPastedCoverImageName(
  currentFilePath: string | null | undefined,
  mimeType: string,
  now = Date.now(),
): string {
  const noteBaseName =
    currentFilePath
      ?.split(/[\\/]/)
      .pop()
      ?.replace(/\.(md|markdown)$/i, "") || "note";
  return `${noteBaseName}-wechat-cover-${now}.${getImageFileExtension(mimeType)}`;
}

export async function savePastedCoverImage(options: {
  file: File;
  rootFolderPath: string;
  currentFilePath?: string | null;
  resourceFolder: string;
  attachmentLocation: AttachmentLocation;
}): Promise<string> {
  const imageName = buildPastedCoverImageName(
    options.currentFilePath,
    options.file.type,
  );
  const { absoluteDir } = resolveAttachmentTargetDir({
    location: options.attachmentLocation,
    rootFolderPath: options.rootFolderPath,
    currentFilePath: options.currentFilePath,
    resourceFolder: options.resourceFolder,
  });
  const imagePath = joinFsPath(absoluteDir, imageName);
  const fileSystem = await getFileSystem();
  await fileSystem.createDirectory(absoluteDir);
  if (!fileSystem.writeBinaryFile) {
    throw new Error("Binary file writes are not available.");
  }
  await fileSystem.writeBinaryFile(
    imagePath,
    new Uint8Array(await options.file.arrayBuffer()),
  );
  return imagePath;
}
