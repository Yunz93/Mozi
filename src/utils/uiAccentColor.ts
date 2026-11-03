export const DEFAULT_UI_ACCENT_COLOR = "default";

export function normalizeUiAccentColor(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_UI_ACCENT_COLOR;
  const color = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(color)) return color;
  if (/^#[\da-f]{3}$/.test(color)) {
    return `#${color
      .slice(1)
      .split("")
      .map((channel) => channel.repeat(2))
      .join("")}`;
  }
  return DEFAULT_UI_ACCENT_COLOR;
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((offset) =>
    parseInt(hex.slice(offset, offset + 2), 16),
  ) as Rgb;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  ) as Rgb;
}

function hex(color: Rgb): string {
  return `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(color: Rgb): number {
  return color.reduce((sum, channel, index) => {
    const value = channel / 255;
    return (
      sum +
      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index]
    );
  }, 0);
}

function contrast(first: Rgb, second: Rgb): number {
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

export function getUiAccentColorVariables(
  value: unknown,
  canvasColor: string,
): Record<string, string> {
  const color = normalizeUiAccentColor(value);
  if (color === DEFAULT_UI_ACCENT_COLOR) return {};
  const background = rgb(
    normalizeUiAccentColor(canvasColor) === DEFAULT_UI_ACCENT_COLOR
      ? "#faf8f3"
      : normalizeUiAccentColor(canvasColor),
  );
  const original = rgb(color);
  const dark = luminance(background) < 0.5;
  const target: Rgb = dark ? [255, 255, 255] : [0, 0, 0];
  let accent = original;
  let active = mix(background, accent, dark ? 0.18 : 0.12);

  // 选中色同时适配主表面和选中底色，避免自定义浅色或深色导致文字难以辨认。
  for (let step = 0; step <= 100; step += 1) {
    accent = mix(original, target, step / 100);
    active = mix(background, accent, dark ? 0.18 : 0.12);
    if (contrast(accent, background) >= 4.5 && contrast(accent, active) >= 4.5)
      break;
  }
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];
  const foreground =
    contrast(white, accent) >= contrast(black, accent) ? white : black;
  const hover = mix(accent, foreground === white ? black : white, 0.12);

  return {
    "--workspace-accent": hex(accent),
    "--workspace-active": hex(active),
    "--workspace-primary-bg": hex(accent),
    "--workspace-primary-text": hex(foreground),
    "--workspace-primary-hover": hex(hover),
  };
}
