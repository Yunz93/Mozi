/**
 * WKWebView 兼容性集中管理
 *
 * Tauri release 在 macOS 使用 WKWebView 作为 Web 运行时，与浏览器 dev 模式
 * 存在若干行为差异。本模块集中收纳所有已知差异和 workaround，避免散落各处。
 *
 * 规则：
 * - 每个 quirk 有独立的 export／常量／谓词函数
 * - 新增 WKWebView 相关 workaround 时必须在此模块登记
 * - 通过 `isWKWebView()` 判断当前是否运行在 WKWebView 环境
 */

import { isTauriEnvironment } from "../types/filesystem";

// ── 检测 ────────────────────────────────────────────────────────

/** 是否运行在 macOS WKWebView（不同于 Windows WebView2 或浏览器） */
export function isWKWebView(): boolean {
  if (typeof window === "undefined") return false;
  if (!isTauriEnvironment()) return false;
  // WKWebView UA 包含 "AppleWebKit"，WebView2 不含
  return /AppleWebKit/i.test(navigator.userAgent);
}

/** 是否运行在任何 Tauri WebView（WKWebView 或 WebView2） */
export function isTauriWebView(): boolean {
  return isTauriEnvironment();
}

// ── Quirk 1: innerHTML 往返剥离 inline style ─────────────────────

/**
 * WKWebView 通过 innerHTML 序列化 DOM 子树时，可能剥离元素上的 inline style。
 * 这对 Shiki 代码高亮是致命的——所有 token 颜色都在 span.style 上。
 *
 * 应对：
 * - shikiHtmlSnapshots.ts 在 DOM 操作前将 <pre class="shiki"> 整体替换为占位符，
 *   innerHTML 读回后再从快照恢复
 * - 所有依赖 innerHTML 做 DOM 变换的代码，应优先用 DOM API 而非字符串操作
 */
export function shouldProtectInlineStylesForDOMReadback(): boolean {
  return isWKWebView();
}

// ── Quirk 2: CSS @font-face url() 不支持自定义协议 ───────────────

/**
 * WKWebView 的 CSS 资源加载器无法通过 @font-face { src: url("tauri://...") }
 * 加载字体。必须绕过 CSS，用 JS Fetch + FontFace API 注册字体。
 *
 * 应对：
 * - fontSettings.ts 中 KaTeX 的字体加载分支使用 FontFace API
 * - 不要在任何 CSS 中写 src: url("tauri://...") 来加载字体
 */
export function shouldUseFontFaceApi(): boolean {
  return isWKWebView();
}

// ── Quirk 3: clip-path 中图片永不触发 load ───────────────────────

/**
 * WKWebView 中通过 clip-path 裁剪的 <img> 可能永远不触发 load/error 事件，
 * 导致 html2canvas 的 waitForImages 无限等待。
 *
 * 应对：
 * - exportRasterHost.ts 用 visibility: visible; opacity: 0.01 代替 clip-path
 *   确保图片在视口内正常解码
 */
export function shouldAvoidClipPathForImageDecode(): boolean {
  return isWKWebView();
}

// ── Quirk 4: 长时间同步操作卡死 WKWebView ────────────────────────

/**
 * WKWebView 的 JS 引擎在主线程上对同步耗时操作更敏感。html2canvas 单次 capture
 * 范围过大时，会导致 WebView 无响应。
 *
 * 应对：
 * - longImageExport.ts 通过 computeSafeLongImageRenderScale 压低 render scale，
 *   把输出画布限制在平台安全上限内（未做分 tile 拼接；scale 明显降低时会提示用户）
 * - 降低 render scale 减少像素处理量
 * - 各超时常量见下方 export
 */

/** 单块 html2canvas 输出 canvas 的最大高度，避免 WKWebView 同步卡死 */
export const WK_CANVAS_TILE_MAX_HEIGHT = 2048;

/** 每次 capture 最多处理的文档高度（px），控制 html2canvas 遍历范围 */
export const WK_RASTER_VIEWPORT_DOC_HEIGHT = 960;

/** 长图 raster 上限 scale，过高会在 WKWebView 中单次 capture 卡死 */
export const WK_RASTER_MAX_SCALE = 1.75;

// ── Quirk 5: CSS 自定义属性（var()）在 html2canvas 中不可用 ──────

/**
 * html2canvas 不解析 CSS 自定义属性（var(--xxx)），在 WKWebView 和浏览器
 * 中都一样。但在 WKWebView 中，因为协议限制，额外的回退方案（如 getComputedStyle）
 * 可能返回不一致的值。
 *
 * 应对：
 * - export/styles.ts 在 html2canvas 渲染前将 var() 展开为具体值
 * - 不要依赖 html2canvas 能自行解析 CSS 变量
 */
export function shouldResolveCSSVariablesForRaster(): boolean {
  // 浏览器和 WKWebView 都需要，但 WKWebView 更需要——getComputedStyle
  // 在 custom protocol 下可能返回不完整的结果
  return isWKWebView();
}

// ── Quirk 6: 预览 wiki embed 尺寸属性在 innerHTML 读回时丢失 ─────

/**
 * WKWebView 在 innerHTML 读回时可能剥离 data-wiki-embed-w/h 等自定义属性，
 * 或改变 attribute 大小写（data-* 大小写不敏感但 WKWebView 行为不一致）。
 *
 * 应对：
 * - previewMedia.ts 的 hasWikiEmbedsInHtml 用不区分大小写的正则匹配
 * - usePreviewRenderer.ts 中 wiki embed 尺寸信息用 typed attr() fallback
 */
export function shouldGuardWikiEmbedAttributes(): boolean {
  return isWKWebView();
}

// ── Quirk 7: CSP 执行差异 ────────────────────────────────────────

/**
 * Dev 模式浏览器无 CSP，release 有严格 CSP。
 * 在 dev server 中通过 cspDevPlugin.ts 注入相同的 CSP header 来提前发现问题。
 *
 * 受影响的指令：
 * - connect-src: fetch/XHR/WebSocket 目标受限
 * - font-src: 字体加载来源受限
 * - img-src: 图片加载来源受限
 * - script-src: 禁止 inline script、禁止 eval（除非 'unsafe-eval'）
 *
 * 额外的 release-only 陷阱（dev 无法复现）：Tauri 在打包时会自动向 CSP 注入
 * nonce/hash（"asset CSP modification"）。一旦 style-src 中出现 nonce，按 CSP
 * 规范 'unsafe-inline' 会被浏览器忽略，导致：
 * - Shiki 高亮失色（token 颜色全在 span 的 inline style 属性上，style 属性
 *   无法携带 nonce，只能靠 'unsafe-inline' 放行）
 * - Mermaid 图裂开（官方 mermaid 运行时注入 <style>；beautiful-mermaid 的
 *   SVG 依赖 inline style 属性与 <style> 块，均无 nonce）
 *
 * 应对：tauri.conf.json 中设置
 * `"dangerousDisableAssetCspModification": ["style-src"]`，
 * 只关闭 style-src 的 nonce 注入让 'unsafe-inline' 恢复生效；script-src 的
 * hash 注入保持开启（index.html 的 inline boot script 依赖它）。
 * 回归防护见 cspParity.test.ts。
 */

// ── 汇总 ─────────────────────────────────────────────────────────

/** 获取当前 WKWebView 兼容性配置，供调试和诊断使用 */
export function getWebKitCompatSummary(): Record<string, unknown> {
  return {
    isWKWebView: isWKWebView(),
    isTauriWebView: isTauriWebView(),
    shouldUseFontFaceApi: shouldUseFontFaceApi(),
    shouldProtectInlineStylesForDOMReadback:
      shouldProtectInlineStylesForDOMReadback(),
    shouldAvoidClipPathForImageDecode: shouldAvoidClipPathForImageDecode(),
    shouldResolveCSSVariablesForRaster: shouldResolveCSSVariablesForRaster(),
    shouldGuardWikiEmbedAttributes: shouldGuardWikiEmbedAttributes(),
    canvasTileMaxHeight: WK_CANVAS_TILE_MAX_HEIGHT,
    rasterViewportDocHeight: WK_RASTER_VIEWPORT_DOC_HEIGHT,
    rasterMaxScale: WK_RASTER_MAX_SCALE,
  };
}
