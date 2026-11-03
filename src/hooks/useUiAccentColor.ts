import { useLayoutEffect } from "react";
import type { ThemeMode } from "../types";
import { getUiAccentColorVariables } from "../utils/uiAccentColor";

export function useUiAccentColor(color: string, themeMode: ThemeMode): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const canvas = getComputedStyle(root)
      .getPropertyValue("--workspace-canvas")
      .trim();
    const variables = getUiAccentColorVariables(color, canvas);
    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }
    // 写到根节点，使弹出的下拉菜单也使用同一主题色；恢复默认时撤回覆盖。
    return () => {
      for (const name of Object.keys(variables))
        root.style.removeProperty(name);
    };
  }, [color, themeMode]);
}
