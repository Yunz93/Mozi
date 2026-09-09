export const WEREAD_SKILL_VERSION = "1.0.4";

export const WEREAD_SOURCE = "weread";
export const WEREAD_BOOK_ID_KEY = "weread_book_id";
export const WEREAD_GENERATED_END_MARKER = "<!-- weread:generated-end -->";
export const WEREAD_USER_APPENDIX_MARKER = "<!-- weread:user-appendix -->";

export function wereadBookmarkMarker(id: string): string {
  return `<!-- weread:bookmark:${id} -->`;
}

export function wereadReviewMarker(id: string): string {
  return `<!-- weread:review:${id} -->`;
}

export function wereadHotHighlightMarker(id: string): string {
  return `<!-- weread:hot:${id} -->`;
}
