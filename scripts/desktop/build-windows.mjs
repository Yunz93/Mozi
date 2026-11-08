import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Retry only the observed transient NSIS download failure, never compile errors.
for (let attempt = 1; attempt <= 3; attempt++) {
  let tail = "";
  const child = spawn(
    process.execPath,
    [
      resolve("node_modules/@tauri-apps/cli/tauri.js"),
      attempt === 1 ? "build" : "bundle",
      "--bundles",
      "nsis",
      "--no-sign",
      "--config",
      "src-tauri/tauri.desktop-smoke.conf.json",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const [stream, destination] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ])
    stream.on("data", (chunk) => {
      destination.write(chunk);
      tail = (tail + chunk).slice(-32000);
    });
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("close", accept);
  });
  if (code === 0) break;
  if (
    attempt === 3 ||
    !/failed to bundle project[^\n]*http status:\s*(429|5\d\d)/.test(tail)
  )
    throw new Error(`Windows package build failed (${code})`);
  console.log(
    `Retrying transient bundler download failure (attempt ${attempt + 1}/3)`,
  );
  await delay(5000);
}
