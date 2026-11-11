import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function useUbuntuHttpsSources(source) {
  return source
    .replace(
      /mirror\+file:\/etc\/apt\/apt-mirrors\.txt(?=\s|$)/g,
      "https://archive.ubuntu.com/ubuntu/",
    )
    .replace(
      /http:\/\/(?:azure\.archive|archive|security)\.ubuntu\.com\/ubuntu(?=[/\s]|$)/g,
      (url) =>
        url
          .replace("http://", "https://")
          .replace("azure.archive.ubuntu.com", "archive.ubuntu.com"),
    );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== "linux") throw new Error("需要 Ubuntu runner");
  // 只替换 Ubuntu 下载地址，保留发行套件、组件与签名密钥配置。
  for (const path of [
    "/etc/apt/sources.list",
    "/etc/apt/sources.list.d/ubuntu.sources",
  ]) {
    if (!existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    const updated = useUbuntuHttpsSources(source);
    if (source !== updated) writeFileSync(path, updated);
  }
}
