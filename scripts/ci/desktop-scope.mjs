import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function requiresDesktop(event, files) {
  if (!["push", "pull_request"].includes(event) || !Array.isArray(files))
    return true;
  return files.some(
    (file) =>
      typeof file !== "string" ||
      !/^(docs\/|[^/]+\.md$|LICENSE[^/]*$|\.github\/(ISSUE_TEMPLATE\/|PULL_REQUEST_TEMPLATE\.md$|release-body\.md$))/.test(
        file,
      ),
  );
}

function changedFiles(before, head) {
  const valid = (sha) => /^[a-f0-9]{40}$/.test(sha ?? "") && !/^0+$/.test(sha);
  if (!valid(before) || !valid(head)) return null;
  try {
    return execFileSync("git", ["diff", "--name-only", "-z", before, head], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    // 无法确定改动范围时执行完整桌面测试，不让检查缺失变成跳过。
    return null;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const run = requiresDesktop(
    process.env.GITHUB_EVENT_NAME,
    changedFiles(process.env.BASE_SHA, process.env.HEAD_SHA),
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `run_desktop=${run}\n`);
  console.log(`Desktop suite required: ${run}`);
}
