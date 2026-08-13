/**
 * Utility functions for preview components
 */

export function isImageAttachment(fileName: string): boolean {
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(fileName);
}

export function isMarkdownNote(fileName: string): boolean {
  if (/\.excalidraw(?:\.json|\.md)?$/i.test(fileName)) return false;
  return /\.(md|markdown)$/i.test(fileName);
}

export function isPdfAttachment(fileName: string): boolean {
  return /\.pdf$/i.test(fileName);
}

export function isHtmlDocument(fileName: string): boolean {
  return /\.html?$/i.test(fileName);
}

export function isExternalLink(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href.trim());
}

/**
 * Validate external URL to prevent opening dangerous protocols
 * Only allows http:// and https:// URLs
 */
export function isValidExternalUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
