/**
 * Vite 插件：在 dev server 中注入与 Tauri release 相同的 CSP header
 * 让 CSP 违规在 dev 阶段就能在浏览器控制台被发现，而不是到 release 才报错
 */
import type { Plugin } from "vite";

// 与 src-tauri/tauri.conf.json 中 app.security.csp 保持一致
// 额外加入 Vite dev server 必需的 ws: (HMR WebSocket) 和 'unsafe-inline' (HMR inline script)
// 这两项在 Tauri release 中不需要（无 HMR、无 inline script），仅 dev 使用
//
// 注意：dev header 无法模拟 Tauri release 的 nonce 注入行为。Tauri 打包时会向
// style-src 追加 nonce，令 'unsafe-inline' 失效（Shiki inline style / Mermaid
// 运行时 <style> 会被静默拦截）。因此 tauri.conf.json 中通过
// dangerousDisableAssetCspModification: ["style-src"] 关闭该注入，
// 使 release 的 style-src 与本文件保持一致。详见 webkitCompat.ts Quirk 7。
export const DEV_CSP =
  "default-src 'self'; " +
  "connect-src 'self' ipc: http: https: ws: blob: asset:; " +
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' blob: asset:; " +
  "worker-src 'self' blob: asset:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: asset: http: https:; " +
  "font-src 'self' data: blob: asset:; " +
  "frame-src 'self' https: blob: asset:; " +
  "object-src 'self' blob: asset:; " +
  "media-src 'self' blob: asset: http: https:;";

export function cspDevPlugin(): Plugin {
  return {
    name: "csp-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", DEV_CSP);
        next();
      });
    },
  };
}
