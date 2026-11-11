import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OFFICIAL_ARCHIVE = "https://archive.ubuntu.com/ubuntu/";
const FALLBACK_ARCHIVE = "https://mirrors.edge.kernel.org/ubuntu/";

export async function selectUbuntuArchive(suite, fetchImpl = fetch) {
  if (typeof suite !== "string" || !/^[a-z]+$/.test(suite))
    throw new Error("无效的 Ubuntu 发行代号");
  for (const archive of [OFFICIAL_ARCHIVE, FALLBACK_ARCHIVE]) {
    try {
      const response = await fetchImpl(`${archive}dists/${suite}/InRelease`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (
        !(await response.text()).startsWith(
          "-----BEGIN PGP SIGNED MESSAGE-----",
        )
      )
        throw new Error("缺少签名索引");
      console.log(`Ubuntu APT archive: ${archive}`);
      return archive;
    } catch (error) {
      console.log(
        `Ubuntu APT probe failed: ${archive} (${error.message}; ${error.cause?.code ?? "no-code"}: ${error.cause?.message ?? "no-cause"})`,
      );
    }
  }
  throw new Error("Ubuntu 主源与备用镜像均不可达，停止安装系统依赖。");
}

export function useUbuntuHttpsSources(source, archive = OFFICIAL_ARCHIVE) {
  const updated = source
    .replace(
      /mirror\+file:\/etc\/apt\/apt-mirrors\.txt(?=\s|$)/g,
      OFFICIAL_ARCHIVE,
    )
    .replace(
      /http:\/\/(?:azure\.archive|archive|security)\.ubuntu\.com\/ubuntu(?=[/\s]|$)/g,
      (url) =>
        url
          .replace("http://", "https://")
          .replace("azure.archive.ubuntu.com", "archive.ubuntu.com"),
    );
  return archive === OFFICIAL_ARCHIVE
    ? updated
    : updated.replace(
        /https:\/\/(?:archive|security)\.ubuntu\.com\/ubuntu\/?(?=\s|$)/g,
        archive,
      );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.platform !== "linux") throw new Error("需要 Ubuntu runner");
  const suite = readFileSync("/etc/os-release", "utf8").match(
    /^VERSION_CODENAME=([a-z]+)$/m,
  )?.[1];
  const archive = await selectUbuntuArchive(suite);
  // 只替换 Ubuntu 下载地址，保留发行套件、组件与签名密钥配置。
  for (const path of [
    "/etc/apt/sources.list",
    "/etc/apt/sources.list.d/ubuntu.sources",
  ]) {
    if (!existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    const updated = useUbuntuHttpsSources(source, archive);
    if (source !== updated) writeFileSync(path, updated);
  }
}
