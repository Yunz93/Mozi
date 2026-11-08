import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [manifestPath, packagePath] = process.argv.slice(2);
const tag = process.env.RELEASE_TAG ?? "";
const repository = process.env.GITHUB_REPOSITORY ?? "";
if (
  !manifestPath ||
  !packagePath ||
  !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(tag) ||
  !/^[\w.-]+\/[\w.-]+$/.test(repository)
) {
  throw new Error(
    "Expected manifest, Debian package, RELEASE_TAG and GITHUB_REPOSITORY.",
  );
}

const version = tag.slice(1);
const asset = basename(packagePath);
if (asset !== `Mozi_${version}_amd64.deb`) {
  throw new Error(
    "Linux updater asset does not match the release version and architecture.",
  );
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (
  manifest.version !== version ||
  !manifest.platforms?.["darwin-aarch64"] ||
  !manifest.platforms?.["windows-x86_64"]
) {
  throw new Error(
    "Expected the same-version macOS and Windows updater manifest.",
  );
}

const signature = readFileSync(`${packagePath}.sig`, "utf8").trim();
if (
  !Buffer.from(signature, "base64")
    .toString("utf8")
    .startsWith("untrusted comment:")
) {
  throw new Error("Linux updater signature is missing or malformed.");
}

// 保留现有平台、发布时间和发布说明，只补充当前 Debian 包的下载地址与签名。
const platform = {
  url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`,
  signature,
};
manifest.platforms["linux-x86_64-deb"] = platform;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared signed Linux updater entries for ${tag}.`);
