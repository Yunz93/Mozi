export function seedSettingsOnUnload(settings) {
  const { window, localStorage } = globalThis;
  const serialized = JSON.stringify({ state: { settings }, version: 0 });
  const seed = () => {
    localStorage.clear();
    localStorage.setItem("markdown-press-settings", serialized);
  };
  seed();
  // 旧页面的异步持久化可能尚未结束，在真实导航前最后写入恢复夹具。
  window.addEventListener("beforeunload", seed, { once: true });
  // WKWebView 不保证发送 beforeunload；pagehide 是导航时的最终写入机会。
  window.addEventListener(
    "pagehide",
    () => {
      seed();
      window.removeEventListener("beforeunload", seed);
    },
    { once: true },
  );
}
