export function seedSettingsOnUnload(settings) {
  const { window, localStorage } = globalThis;
  const serialized = JSON.stringify({ state: { settings }, version: 0 });
  // 旧页面的异步持久化可能尚未结束，在真实导航前最后写入恢复夹具。
  window.addEventListener(
    "beforeunload",
    () => {
      localStorage.clear();
      localStorage.setItem("markdown-press-settings", serialized);
    },
    { once: true },
  );
}
