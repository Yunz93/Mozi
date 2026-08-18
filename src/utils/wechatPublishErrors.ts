export type WechatPublishErrorKind =
  | "appId"
  | "appSecret"
  | "title"
  | "ipAllowlist"
  | "invalidAppId"
  | "invalidSecret"
  | "quota"
  | "media"
  | "permission"
  | "network"
  | "generic";

const WECHAT_API_ERROR_RE = /WeChat API error\s+(-?\d+)/i;

function looksLikeWechatError(message: string): boolean {
  return /wechat/i.test(message) || /微信/i.test(message);
}

function apiCode(message: string): number | null {
  const match = WECHAT_API_ERROR_RE.exec(message);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}

/**
 * Classify WeChat draft publish failures so the UI can show a stepwise
 * fix (credentials, IP allowlist, cover, quota) instead of a raw API string.
 */
export function classifyWechatPublishError(
  message: string,
): WechatPublishErrorKind | null {
  const normalized = message.trim();
  if (!normalized) return null;

  if (/WeChat AppID is required/i.test(normalized)) return "appId";
  if (/WeChat AppSecret is required/i.test(normalized)) return "appSecret";
  if (/WeChat draft title is required/i.test(normalized)) return "title";

  const code = apiCode(normalized);
  const lower = normalized.toLowerCase();

  if (
    code === 40164 ||
    /invalid ip/i.test(normalized) ||
    /ip.*whitelist/i.test(normalized) ||
    /not in whitelist/i.test(normalized) ||
    /不在白名单/.test(normalized)
  ) {
    return "ipAllowlist";
  }

  if (code === 40013 || /invalid appid/i.test(normalized)) {
    return "invalidAppId";
  }

  if (
    code === 40125 ||
    code === 40001 ||
    /invalid appsecret/i.test(normalized) ||
    /invalid credential/i.test(normalized)
  ) {
    return "invalidSecret";
  }

  if (code === 45009 || /api daily quota/i.test(normalized)) {
    return "quota";
  }

  if (
    code === 40007 ||
    code === 40118 ||
    /invalid media/i.test(normalized) ||
    (/thumbnail/i.test(normalized) && /upload/i.test(normalized))
  ) {
    return "media";
  }

  if (code === 48001 || /api unauthorized/i.test(normalized)) {
    return "permission";
  }

  if (
    /failed to request wechat access token/i.test(normalized) ||
    /failed to create wechat api client/i.test(normalized) ||
    /failed to upload .+ to wechat api/i.test(normalized)
  ) {
    return "network";
  }

  if (!looksLikeWechatError(normalized) && code === null) {
    return null;
  }

  if (looksLikeWechatError(normalized) || code !== null) {
    if (/appid/i.test(lower) && /required|invalid|empty/.test(lower)) {
      return "appId";
    }
    return "generic";
  }

  return null;
}
