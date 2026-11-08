import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
  lstat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const exec = promisify(execFile);
export const TEST_ID = "com.bxyz.markdown-press.desktop-e2e";
const STOCK_ID = "com.bxyz.markdown-press";
const OWNER = ".mozi-desktop-acceptance-owner.json";

function profileDirectories(id) {
  if (process.platform === "darwin")
    return ["Application Support", "Caches", "WebKit"].map((folder) =>
      join(homedir(), "Library", folder, id),
    );
  if (process.platform === "win32")
    return [
      ...new Set(
        [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean),
      ),
    ].map((folder) => join(folder, id));
  return [
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
  ].map((folder) => join(folder, id));
}

/** Reset only marked test profiles; refuse to overwrite an existing user profile. */
export async function resetProfile(stock = false) {
  if (stock && process.env.GITHUB_ACTIONS !== "true")
    throw new Error(
      "Stock-profile testing requires an ephemeral GitHub Actions runner",
    );
  const id = stock ? STOCK_ID : TEST_ID;
  for (const directory of profileDirectories(id))
    await resetOwnedDirectory(directory, id);
  if (process.platform === "darwin") {
    // CFPreferences caches domains outside the application process.
    try {
      await exec("defaults", ["delete", id]);
    } catch (error) {
      if (error.code !== 1) throw error;
    }
  }
}

export async function resetOwnedDirectory(directory, id) {
  if (![TEST_ID, STOCK_ID].includes(id) || basename(directory) !== id)
    throw new Error("Invalid profile boundary");
  try {
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error(`Refusing a symbolic-link profile: ${directory}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let entries = [];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (entries.length) {
    let owner;
    try {
      owner = JSON.parse(await readFile(join(directory, OWNER), "utf8"));
    } catch {
      /* Checked below. */
    }
    if (owner?.tool !== "mozi-desktop-acceptance" || owner.identifier !== id)
      throw new Error(`Refusing to replace an unowned profile: ${directory}`);
    await rm(directory, { recursive: true, maxRetries: 20, retryDelay: 150 });
  }
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, OWNER),
    JSON.stringify({ tool: "mozi-desktop-acceptance", identifier: id }),
  );
}

export async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const port = server.address().port;
  await new Promise((accept) => server.close(accept));
  return port;
}

export function launch(command, args, env, logPath) {
  const log = createWriteStream(logPath);
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    detached: process.platform !== "win32",
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("error", (error) => {
    log.write(String(error));
    child.launchError = error;
  });
  child.once("close", () => log.end());
  return child;
}

export async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === "win32") {
    try {
      await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]);
    } catch (error) {
      if (![128, 255].includes(error.code)) throw error;
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    for (let i = 0; i < 30 && child.exitCode === null && !child.signalCode; i++)
      await delay(100);
    if (child.exitCode === null && !child.signalCode) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  await delay(300);
}

export async function processSnapshot() {
  if (process.platform === "win32") {
    const script =
      "@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,ExecutablePath,Name) | ConvertTo-Json -Compress";
    const { stdout } = await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { maxBuffer: 8_000_000 },
    );
    return JSON.parse(stdout).map((p) => ({
      pid: p.ProcessId,
      parent: p.ParentProcessId,
      bytes: Number(p.WorkingSetSize),
      name: p.Name,
      executable: p.ExecutablePath,
    }));
  }
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,rss=,comm="], {
    maxBuffer: 8_000_000,
  });
  return stdout.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            bytes: Number(match[3]) * 1024,
            name: basename(match[4]),
            executable: match[4],
          },
        ]
      : [];
  });
}

export async function sampleMemory(appPid, beforePids, binary) {
  const processes = await processSnapshot();
  if (!appPid)
    appPid = processes.find(
      (p) =>
        p.executable &&
        resolve(p.executable).toLowerCase() === resolve(binary).toLowerCase(),
    )?.pid;
  if (!appPid) throw new Error("Cannot attribute the application process");
  const owned = new Set([appPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes)
      if (owned.has(process.parent) && !owned.has(process.pid)) {
        owned.add(process.pid);
        changed = true;
      }
  }
  const included = processes.filter(
    (p) =>
      owned.has(p.pid) ||
      (process.platform === "darwin" &&
        !beforePids.has(p.pid) &&
        /WebKit[. ]/.test(p.name)),
  );
  return {
    metric: process.platform === "win32" ? "working-set" : "rss",
    bytes: included.reduce((sum, p) => sum + p.bytes, 0),
    attribution:
      process.platform === "darwin"
        ? "app tree plus newly observed WebKit services; reused XPC services may be omitted"
        : "application process tree; shared pages can be counted more than once",
    processes: included.map(({ pid, name, bytes }) => ({ pid, name, bytes })),
  };
}
