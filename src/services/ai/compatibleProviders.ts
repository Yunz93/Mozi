import type { AIProvider, AppSettings } from "../../types";

// 官方标准 API；套餐专用地址可在设置中覆盖，密钥按供应商独立保存。
export const COMPATIBLE_PROVIDERS = {
  glm: {
    label: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.2"],
    discovery: false,
  },
  kimi: {
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3.1-pro",
    models: [
      "kimi-k3.1-pro",
      "kimi-k3.1-pro-highspeed",
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.6",
    ],
    discovery: true,
  },
  mimo: {
    label: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-flash",
    models: ["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed"],
    discovery: true,
  },
} as const;

export type CompatibleProvider = keyof typeof COMPATIBLE_PROVIDERS;

export function isCompatibleProvider(
  provider: AIProvider,
): provider is CompatibleProvider {
  return provider === "glm" || provider === "kimi" || provider === "mimo";
}

export function resolveCompatibleSettings(
  provider: CompatibleProvider,
  settings: AppSettings,
) {
  const defaults = COMPATIBLE_PROVIDERS[provider];
  const apiKey = settings[`${provider}ApiKey`];
  const baseUrl = settings[`${provider}ApiBaseUrl`];
  const model = settings[`${provider}Model`];
  return {
    ...defaults,
    apiKey: typeof apiKey === "string" ? apiKey.trim() : "",
    baseUrl:
      (typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "") ||
      defaults.baseUrl,
    model: (typeof model === "string" ? model.trim() : "") || defaults.model,
  };
}
