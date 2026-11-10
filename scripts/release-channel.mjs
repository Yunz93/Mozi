import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function resolveReleaseChannel(tag, expectedChannel = "") {
  const match =
    /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(-beta\.[1-9]\d*)?)$/.exec(
      tag ?? "",
    );
  if (!match || match[0] !== tag) {
    throw new Error(
      "发布标签仅支持 vX.Y.Z-beta.N（N 从 1 递增）或明确要求的正式版 vX.Y.Z。",
    );
  }
  const prerelease = Boolean(match[2]);
  const channel = prerelease ? "beta" : "stable";
  if (expectedChannel && channel !== expectedChannel) {
    throw new Error(
      `发布标签 ${tag} 属于 ${channel}，与指定渠道 ${expectedChannel} 不符。`,
    );
  }
  return {
    channel,
    version: match[1],
    prerelease,
    release_name: `${prerelease ? "Beta" : "Release"} ${tag}`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = resolveReleaseChannel(
      process.argv[2] || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME,
      process.env.RELEASE_CHANNEL,
    );
    const output = Object.entries(result)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("");
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, output);
    console.log(output.trimEnd());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
