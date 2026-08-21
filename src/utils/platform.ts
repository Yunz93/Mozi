export function getPlatformIdentifier(): string {
  if (typeof navigator === "undefined") return "";

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  return [nav.userAgentData?.platform, navigator.platform, navigator.userAgent]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isWindowsPlatform(): boolean {
  return getPlatformIdentifier().includes("win");
}

export function isMacOSPlatform(): boolean {
  const identifier = getPlatformIdentifier();
  return (
    identifier.includes("mac") ||
    identifier.includes("iphone") ||
    identifier.includes("ipad") ||
    identifier.includes("ipod") ||
    identifier.includes("darwin")
  );
}
