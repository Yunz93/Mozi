/** 编码 HTTP 链接中的空格与非 ASCII 字符，本地路径继续交给附件层。 */
export function normalizeHttpUrlForHtmlAttribute(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    return encodeURI(decodeURI(url));
  } catch {
    try {
      return encodeURI(url);
    } catch {
      return url.replace(/ /g, "%20");
    }
  }
}
