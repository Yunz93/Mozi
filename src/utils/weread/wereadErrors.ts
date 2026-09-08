export type WereadErrorKind =
  | "apiKey"
  | "upgrade"
  | "auth"
  | "network"
  | "notTauri"
  | "noVault"
  | "generic";

export function classifyWereadError(message: string): WereadErrorKind | null {
  const normalized = message.trim();
  if (!normalized) return null;

  if (
    /WeRead API key is required/i.test(normalized) ||
    /weread api key/i.test(normalized)
  ) {
    return "apiKey";
  }
  if (
    /WeRead skill upgrade required/i.test(normalized) ||
    /upgrade_info/i.test(normalized)
  ) {
    return "upgrade";
  }
  if (
    /not in tauri/i.test(normalized) ||
    /secure settings backend is unavailable/i.test(normalized)
  ) {
    return "notTauri";
  }
  if (
    /no knowledge base/i.test(normalized) ||
    /请先打开知识库/.test(normalized)
  ) {
    return "noVault";
  }

  const codeMatch = /WeRead API error\s+(-?\d+)/i.exec(normalized);
  const code = codeMatch ? Number(codeMatch[1]) : null;
  if (
    code === 401 ||
    code === 403 ||
    code === -2010 ||
    code === -2012 ||
    /unauthorized/i.test(normalized) ||
    /invalid.+api.?key/i.test(normalized) ||
    /登录超时/.test(normalized) ||
    /access_token/i.test(normalized)
  ) {
    return "auth";
  }

  if (
    /failed to request weread/i.test(normalized) ||
    /failed to create weread api client/i.test(normalized) ||
    /failed to parse weread/i.test(normalized) ||
    /network/i.test(normalized)
  ) {
    return "network";
  }

  if (
    /weread/i.test(normalized) ||
    /微信读书/.test(normalized) ||
    code !== null
  ) {
    return "generic";
  }

  return null;
}

export function extractWereadUpgradeMessage(message: string): string | null {
  const match = /WeRead skill upgrade required:\s*(.+)$/i.exec(message.trim());
  const detail = match?.[1]?.trim();
  return detail || null;
}

export function extractWereadApiMessage(message: string): string | null {
  const match = /WeRead API error\s+-?\d+:\s*(.+)$/i.exec(message.trim());
  const detail = match?.[1]?.trim();
  return detail && detail !== "unknown error" ? detail : null;
}
