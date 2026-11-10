/**
 * WKWebView 序列化 innerHTML 时可能剥离 Shiki 行内样式。
 * 在 DOM 修改前保留原始高亮片段，序列化后再恢复。
 * 参见 webkitCompat.ts 中的第一个兼容性约束。
 */

// 统一快照带圆角的外层容器；没有容器时只保留高亮代码块。
const SHIKI_BLOCK_HTML_REGEX =
  /<div\b[^>]*\bclass="[^"]*\bmp-shiki-block\b[^"]*"[^>]*>\s*<pre\b[^>]*\bclass="[^"]*\bshiki\b[^"]*"[^>]*>[\s\S]*?<\/pre>\s*<\/div>|<pre\b[^>]*\bclass="[^"]*\bshiki\b[^"]*"[^>]*>[\s\S]*?<\/pre>/gi;

function hashSnapshot(input: string): string {
  // 用确定性短哈希降低占位符冲突风险。
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  // 转为简短的无符号十六进制值。
  return (h >>> 0).toString(16).slice(0, 8).padStart(8, "0");
}

/** 将高亮代码块替换为编号占位符，并保留原始片段。 */
export function protectShikiPresInHtmlString(
  html: string,
  snapshots: string[],
): string {
  return html.replace(SHIKI_BLOCK_HTML_REGEX, (full) => {
    const id = snapshots.push(full) - 1;
    const h = hashSnapshot(full);
    return `<div data-mp-shiki-slot="${id}" data-mp-shiki-h="${h}"></div>`;
  });
}

/** DOM 操作后按编号和哈希恢复快照，兼容 WKWebView 调整属性顺序和空白。 */
export function restoreShikiPresFromSnapshots(
  html: string,
  snapshots: string[],
): string {
  if (snapshots.length === 0) return html;
  let out = html;
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const slotRegex = new RegExp(
      `<div\\b[^>]*?\\bdata-mp-shiki-slot="${i}"[^>]*?\\bdata-mp-shiki-h="[^"]*"[^>]*?></div>`,
      "g",
    );
    out = out.replace(slotRegex, snapshots[i]);
  }
  return out;
}
