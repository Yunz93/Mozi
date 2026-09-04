import { readFile } from "@tauri-apps/plugin-fs";
import {
  createAttachmentResolverContext,
  resolveAttachmentTarget,
} from "./attachmentResolver";
import { parseFrontmatter } from "./frontmatter";
import {
  buildMarkdownDestination,
  parseMarkdownDestination,
} from "./markdownDestination";
import { normalizeRemoteImageUrl } from "./remoteImageUrl";
import { parseWikiLinkReference } from "./wikiLinks";
import { uploadImageToHosting } from "../services/imageHostingService";
import { buildHostedImageFilename } from "./imageHostingFilename";
import type { AppSettings, FileNode } from "../types";
import {
  MARKDOWN_IMAGE_REGEX,
  WIKI_EMBED_REGEX,
  isLikelyRasterOrVectorImagePath,
  isRemoteTarget,
  rebuildMarkdown,
  replaceAsync,
} from "./publish/markdownAssetPipeline";

function decodeMarkdownDestinationPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return "";

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export interface PublishLocalImagesOptions {
  files: FileNode[];
  rootFolderPath?: string | null;
  currentFilePath: string;
  settings: AppSettings;
}

export type PublishLocalImagesResult =
  | { ok: true; markdown: string; uploadedCount: number }
  | { ok: false; reason: "hosting_not_configured" }
  | { ok: false; reason: "upload_failed"; message: string };

/**
 * Before simple-blog publish: upload local image attachments to the configured image host
 * and rewrite markdown to remote URLs. Non-image local files are left unchanged for the
 * existing repo-asset pipeline.
 */
export async function replaceLocalImagesWithHostingForPublish(
  markdownContent: string,
  options: PublishLocalImagesOptions,
): Promise<PublishLocalImagesResult> {
  const { files, rootFolderPath, currentFilePath, settings } = options;
  const { frontmatter, body } = parseFrontmatter(markdownContent);

  const resolverContext = createAttachmentResolverContext(
    files,
    rootFolderPath,
    currentFilePath,
  );
  const pathToUrl = new Map<string, string>();

  const collectNeedsHosting = async (): Promise<boolean> => {
    let needs = false;

    for (const match of body.matchAll(WIKI_EMBED_REGEX)) {
      const reference = parseWikiLinkReference(match[1], { embed: true });
      if (!reference.target || isRemoteTarget(reference.target)) continue;
      const resolved = await resolveAttachmentTarget(
        resolverContext,
        reference.target,
      );
      if (resolved && isLikelyRasterOrVectorImagePath(resolved.path)) {
        needs = true;
        return true;
      }
    }

    for (const match of body.matchAll(MARKDOWN_IMAGE_REGEX)) {
      const destination = parseMarkdownDestination(match[2]);
      const target = decodeMarkdownDestinationPath(destination.path);
      if (!target || isRemoteTarget(target)) continue;
      const resolved = await resolveAttachmentTarget(resolverContext, target);
      if (resolved && isLikelyRasterOrVectorImagePath(resolved.path)) {
        needs = true;
        return true;
      }
    }

    return needs;
  };
  const needsHosting = await collectNeedsHosting();
  if (
    needsHosting &&
    (!settings.imageHosting?.provider ||
      settings.imageHosting.provider === "none")
  ) {
    return { ok: false, reason: "hosting_not_configured" };
  }

  let uploadedCount = 0;

  const ensureUploaded = async (
    sourcePath: string,
    filename: string,
  ): Promise<string> => {
    const cached = pathToUrl.get(sourcePath);
    if (cached) return cached;

    const bytes = await readFile(sourcePath);
    const hostedName = await buildHostedImageFilename(filename, bytes);
    const result = await uploadImageToHosting(
      bytes.buffer as ArrayBuffer,
      hostedName,
      settings,
    );
    pathToUrl.set(sourcePath, result.url);
    uploadedCount += 1;
    return result.url;
  };

  try {
    let transformedBody = await replaceAsync(
      body,
      WIKI_EMBED_REGEX,
      async (match) => {
        const reference = parseWikiLinkReference(match[1], { embed: true });
        if (!reference.target || isRemoteTarget(reference.target)) {
          return match[0];
        }

        const resolved = await resolveAttachmentTarget(
          resolverContext,
          reference.target,
        );
        if (!resolved || !isLikelyRasterOrVectorImagePath(resolved.path)) {
          return match[0];
        }

        const url = await ensureUploaded(resolved.path, resolved.name);
        const altText = reference.displayText || resolved.name;
        return `![${altText}](${url})`;
      },
    );

    transformedBody = await replaceAsync(
      transformedBody,
      MARKDOWN_IMAGE_REGEX,
      async (match) => {
        const altText = match[1] || "";
        const destination = parseMarkdownDestination(match[2]);
        const target = decodeMarkdownDestinationPath(destination.path);
        if (!target) {
          return match[0];
        }

        if (isRemoteTarget(target)) {
          const normalizedRemoteTarget = normalizeRemoteImageUrl(target);
          if (normalizedRemoteTarget === target) {
            return match[0];
          }
          return `![${altText}](${buildMarkdownDestination(normalizedRemoteTarget, destination)})`;
        }

        const resolved = await resolveAttachmentTarget(resolverContext, target);
        if (!resolved || !isLikelyRasterOrVectorImagePath(resolved.path)) {
          return match[0];
        }

        const url = await ensureUploaded(resolved.path, resolved.name);
        return `![${altText}](${buildMarkdownDestination(url, destination)})`;
      },
    );

    return {
      ok: true,
      markdown: rebuildMarkdown(frontmatter, transformedBody),
      uploadedCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "upload_failed", message };
  }
}
