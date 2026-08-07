import { findOpenWikiLinkAt } from "../../utils/wikiLinkEditor";
import { parseMarkdownDestination } from "../../utils/markdownDestination";

export function isMacPlatform(
  navigatorLike:
    | Pick<Navigator, "platform" | "userAgent">
    | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  if (!navigatorLike) return false;
  return /Mac|iPhone|iPad|iPod/i.test(
    navigatorLike.platform || navigatorLike.userAgent,
  );
}

export function isPreviewModifierPressed(
  event: Pick<KeyboardEvent | MouseEvent, "metaKey" | "ctrlKey">,
  mac = isMacPlatform(),
): boolean {
  return mac ? event.metaKey : event.ctrlKey;
}

export function isPreviewModifierKey(key: string): boolean {
  return key === "Meta" || key === "Control";
}

export function findWikiLinkNearPosition(text: string, pos: number) {
  const offsets = [0, -1, 1, -2, 2];
  for (const offset of offsets) {
    const match = findOpenWikiLinkAt(text, pos + offset);
    if (match) return match;
  }
  return null;
}

export interface LocalImageMatch {
  src: string;
  alt: string;
  from: number;
  to: number;
}

const STANDARD_IMAGE_RE = /!\[([^\]]*)\]\((<[^>\n]+>|[^)\n]+)\)/g;
const OBSIDIAN_IMAGE_RE = /!\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export function isRemoteUrl(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src) || src.startsWith("//");
}

export function findLocalImageAtPos(
  lineFrom: number,
  lineText: string,
  pos: number,
): LocalImageMatch | null {
  let match: RegExpExecArray | null;

  STANDARD_IMAGE_RE.lastIndex = 0;
  while ((match = STANDARD_IMAGE_RE.exec(lineText)) !== null) {
    const mFrom = lineFrom + match.index;
    const mTo = mFrom + match[0].length;
    if (pos >= mFrom && pos <= mTo) {
      const src = parseMarkdownDestination(match[2]).path.trim();
      if (!isRemoteUrl(src) && IMAGE_EXT_RE.test(src)) {
        return {
          src,
          alt:
            match[1] ||
            src
              .split("/")
              .pop()
              ?.replace(/\.[^.]+$/, "") ||
            "image",
          from: mFrom,
          to: mTo,
        };
      }
    }
  }

  OBSIDIAN_IMAGE_RE.lastIndex = 0;
  while ((match = OBSIDIAN_IMAGE_RE.exec(lineText)) !== null) {
    const mFrom = lineFrom + match.index;
    const mTo = mFrom + match[0].length;
    if (pos >= mFrom && pos <= mTo) {
      const src = match[1].trim();
      if (!isRemoteUrl(src) && IMAGE_EXT_RE.test(src)) {
        return {
          src,
          alt:
            match[2] ||
            src
              .split("/")
              .pop()
              ?.replace(/\.[^.]+$/, "") ||
            "image",
          from: mFrom,
          to: mTo,
        };
      }
    }
  }

  return null;
}
