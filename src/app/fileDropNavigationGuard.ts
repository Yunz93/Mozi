/** 阻止未被界面接收的文件拖放替换整个应用文档；不抢先拦截编辑器和侧边栏的处理器。 */
export function installFileDropNavigationGuard(
  target: Window = window,
): () => void {
  const preventNavigation = (event: DragEvent) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    // 原生输入框有自己的安全默认行为（插入文本或选择文件）。
    if (
      event.target instanceof Element &&
      event.target.closest("input, textarea")
    )
      return;
    const types = Array.from(transfer.types ?? []);
    let fileOrUri =
      types.includes("Files") ||
      types.includes("application/x-moz-file") ||
      types.includes("text/uri-list") ||
      !!transfer.files?.length;
    if (!fileOrUri && types.includes("text/plain")) {
      try {
        fileOrUri = /^file:/i.test(
          transfer.getData("text/plain").slice(0, 32).trimStart(),
        );
      } catch {
        return;
      }
    }
    if (fileOrUri) event.preventDefault();
  };
  // 冒泡阶段仅取消默认行为；CodeMirror 等控件先收到原始事件，也可自行停止冒泡。
  target.addEventListener("dragover", preventNavigation);
  target.addEventListener("drop", preventNavigation);
  return () => {
    target.removeEventListener("dragover", preventNavigation);
    target.removeEventListener("drop", preventNavigation);
  };
}
