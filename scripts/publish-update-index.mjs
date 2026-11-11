import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolveReleaseChannel } from "./release-channel.mjs";

const INDEX_BRANCH = "updater-index";
const MAX_VERSION_PART = (1n << 64n) - 1n;

function versionParts(tag) {
  const release = resolveReleaseChannel(tag);
  const [base, beta] = release.version.split("-beta.");
  const parts = [...base.split(".").map(BigInt), beta ? BigInt(beta) : null];
  if (parts.some((part) => part !== null && part > MAX_VERSION_PART))
    throw new Error("版本号超出客户端支持范围。");
  return parts;
}

export function compareReleaseTags(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] === b[index]) continue;
    if (a[index] === null) return 1;
    if (b[index] === null) return -1;
    return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function buildReleaseIndex(releases, verifiedTags) {
  const allowed = new Set(verifiedTags);
  const candidates = new Map();
  for (const release of releases) {
    try {
      const channel = resolveReleaseChannel(release.tag_name);
      versionParts(release.tag_name);
      if (
        !allowed.has(release.tag_name) ||
        release.draft !== false ||
        release.prerelease !== channel.prerelease ||
        !release.assets?.some((asset) => asset.name === "latest.json")
      )
        continue;
      candidates.set(release.tag_name, {
        tag_name: release.tag_name,
        draft: false,
        prerelease: channel.prerelease,
        assets: [{ name: "latest.json" }],
      });
    } catch {
      // 不把其他渠道或无法解析的标签加入客户端索引。
    }
  }
  return {
    schemaVersion: 1,
    releases: [...candidates.values()].sort((left, right) =>
      compareReleaseTags(right.tag_name, left.tag_name),
    ),
  };
}

export async function publishUpdateIndex({
  repository,
  token,
  verifiedTag,
  publish = false,
  fetchImpl = fetch,
  attempt = 0,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !token)
    throw new Error("生成更新索引需要仓库名称及 GitHub Actions 身份。");
  resolveReleaseChannel(verifiedTag);
  versionParts(verifiedTag);
  const root = `/repos/${repository}`;
  const request = async (
    path,
    { method = "GET", body, allowMissing = false } = {},
  ) => {
    const response = await fetchImpl(`https://api.github.com${root}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Mozi-update-index",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      const error = new Error(
        `更新索引请求失败: ${method} ${path} (HTTP ${response.status})`,
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  // 工作流须先验收当前标签；历史记录只保留已经验收并入库的标签。
  const refPath = `/git/refs/heads/${INDEX_BRANCH}`;
  const previousRef = await request(`/git/ref/heads/${INDEX_BRANCH}`, {
    allowMissing: true,
  });
  const parent = previousRef?.object?.sha;
  let previous = { schemaVersion: 1, releases: [] };
  if (previousRef) {
    if (!parent) throw new Error("更新索引分支缺少提交标识。");
    const file = await request(
      `/contents/releases.json?ref=${encodeURIComponent(parent)}`,
    );
    if (file.encoding !== "base64" || typeof file.content !== "string")
      throw new Error("既有更新索引格式无效，已停止覆盖。");
    previous = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
    if (previous.schemaVersion !== 1 || !Array.isArray(previous.releases))
      throw new Error("既有更新索引版本无效，已停止覆盖。");
  }
  // 先固定父提交，再读取发布列表，让期间新增的索引写入触发快进冲突并重试。
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await request(`/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch))
      throw new Error("GitHub Releases 列表格式无效。");
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const index = buildReleaseIndex(releases, [
    ...previous.releases.map((release) => release.tag_name),
    verifiedTag,
  ]);
  if (!index.releases.some((release) => release.tag_name === verifiedTag))
    throw new Error("已验收标签未出现在有效公开 Release 中，已停止更新索引。");
  if (!publish || JSON.stringify(index) === JSON.stringify(previous))
    return { changed: false, index };

  const blob = await request("/git/blobs", {
    method: "POST",
    body: { content: `${JSON.stringify(index, null, 2)}\n`, encoding: "utf-8" },
  });
  const tree = await request("/git/trees", {
    method: "POST",
    body: {
      tree: [
        { path: "releases.json", mode: "100644", type: "blob", sha: blob.sha },
      ],
    },
  });
  const commit = await request("/git/commits", {
    method: "POST",
    body: {
      message: `更新已验收版本索引: ${verifiedTag}`,
      tree: tree.sha,
      parents: parent ? [parent] : [],
    },
  });
  try {
    if (parent) {
      await request(refPath, {
        method: "PATCH",
        body: { sha: commit.sha, force: false },
      });
    } else {
      await request("/git/refs", {
        method: "POST",
        body: { ref: `refs/heads/${INDEX_BRANCH}`, sha: commit.sha },
      });
    }
  } catch (error) {
    // 快进更新使写入串行化；冲突后重读并合并，避免并发发布丢掉较新版本。
    if (![409, 422].includes(error.status) || attempt >= 3) throw error;
    return publishUpdateIndex({
      repository,
      token,
      verifiedTag,
      publish,
      fetchImpl,
      attempt: attempt + 1,
    });
  }
  return { changed: true, index };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { index, changed } = await publishUpdateIndex({
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GH_TOKEN,
      verifiedTag: process.env.RELEASE_TAG,
      publish: process.argv.includes("--publish"),
    });
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex !== -1)
      await writeFile(
        process.argv[outputIndex + 1],
        `${JSON.stringify(index, null, 2)}\n`,
      );
    console.log(
      `更新索引${changed ? "已发布" : "未写入"}，包含 ${index.releases.length} 个已验收版本。`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
