import { useLayoutEffect, useRef } from "react";
import { useI18n } from "../hooks/useI18n";
import {
  isUpdateInstallLocked,
  registerUpdateInstallBlocker,
} from "../services/updateDocumentGuard";

/** 同步遮罩兼容旧版 WKWebView；显示并阻止输入后才允许发送保存回执。 */
export function UpdateInstallGuard() {
  const overlay = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const labels = useRef({
    update: t("settings_updatesInstalling"),
    exit: t("toolbar_saving"),
  });
  labels.current = {
    update: t("settings_updatesInstalling"),
    exit: t("toolbar_saving"),
  };
  const message = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let previousFocus: HTMLElement | null = null;
    const unregister = registerUpdateInstallBlocker(
      (locked, reason = "update") => {
        const element = overlay.current;
        if (!element) return false;
        if (locked) {
          const text = labels.current[reason];
          element.setAttribute("aria-label", text);
          if (message.current) message.current.textContent = text;
          if (element.style.display === "none")
            previousFocus = document.activeElement as HTMLElement | null;
          element.style.display = "flex";
          element.focus({ preventScroll: true });
        } else {
          element.style.display = "none";
          if (previousFocus?.isConnected)
            previousFocus.focus({ preventScroll: true });
          previousFocus = null;
        }
        return !locked || element.style.display === "flex";
      },
    );
    // layout effect 先于父组件的全局快捷键 effect，阻止 capture 监听绕过遮罩。
    const block = (event: Event) => {
      if (!isUpdateInstallLocked()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const events = [
      "keydown",
      "beforeinput",
      "paste",
      "cut",
      "pointerdown",
      "click",
      "drop",
      "dragover",
      "contextmenu",
    ];
    events.forEach((name) => window.addEventListener(name, block, true));
    return () => {
      unregister();
      events.forEach((name) => window.removeEventListener(name, block, true));
    };
  }, []);
  return (
    <div
      ref={overlay}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={t("settings_updatesInstalling")}
      style={{ display: "none" }}
      className="fixed inset-0 z-[2147483647] items-center justify-center bg-black/30"
    >
      <div
        ref={message}
        className="rounded-2xl border border-gray-200 bg-white px-8 py-6 text-sm text-gray-900 dark:border-white/10 dark:bg-gray-900 dark:text-gray-100"
      >
        {t("settings_updatesInstalling")}
      </div>
    </div>
  );
}
