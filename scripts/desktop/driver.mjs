import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";

export async function until(check, message, timeout = 20_000, interval = 75) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await delay(interval);
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ""}`);
}

/** A thin W3C client for native/embedded drivers; no backend/FS mocks. */
export class DesktopDriver {
  constructor(port) {
    this.url = `http://127.0.0.1:${port}`;
  }
  async request(method, path, value) {
    const response = await fetch(this.url + path, {
      method,
      headers: { "content-type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(180_000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(`${method} ${path}: ${JSON.stringify(data.value)}`);
    return data.value;
  }
  async start(provider = "embedded", debuggerAddress) {
    const capabilities =
      provider === "official"
        ? { browserName: "webview2", "ms:edgeOptions": { debuggerAddress } }
        : { "wdio:tauriServiceOptions": { windowLabel: "main" } };
    const result = await this.request("POST", "/session", {
      capabilities: { alwaysMatch: capabilities },
    });
    this.session = result.sessionId;
    this.capabilities = result.capabilities;
    await this.request("POST", this.path("/timeouts"), {
      script: 15_000,
      implicit: 0,
      pageLoad: 120_000,
    });
    // The embedded HTTP server can be ready before the first WebView navigation.
    // Native title evaluation survives that transition; script-result globals do not.
    await until(
      async () => (await this.request("GET", this.path("/title"))) === "墨知",
      "Application document did not finish its initial navigation",
      60_000,
    );
    return result;
  }
  path(suffix) {
    return `/session/${this.session}${suffix}`;
  }
  execute(script, ...args) {
    return this.request("POST", this.path("/execute/sync"), { script, args });
  }
  asyncExecute(script, ...args) {
    return this.request("POST", this.path("/execute/async"), { script, args });
  }
  async invoke(command, args = {}) {
    const result = await this.asyncExecute(
      "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));",
      command,
      args,
    );
    if (!result.ok) throw new Error(`${command}: ${result.error}`);
    return result.value;
  }
  body() {
    return this.execute("return document.body?.innerText || ''");
  }
  editor() {
    return this.execute(
      "return document.querySelector('.cm-content')?.innerText || ''",
    );
  }
  async find(selector) {
    const element = await this.request("POST", this.path("/element"), {
      using: selector.startsWith("//") ? "xpath" : "css selector",
      value: selector,
    });
    return Object.values(element)[0];
  }
  async click(selector) {
    return this.request(
      "POST",
      this.path(`/element/${await this.find(selector)}/click`),
      {},
    );
  }
  button(text) {
    return this.click(`//button[normalize-space(.)=${JSON.stringify(text)}]`);
  }
  async type(selector, text) {
    return this.request(
      "POST",
      this.path(`/element/${await this.find(selector)}/value`),
      { text },
    );
  }
  chord(keys) {
    return this.request("POST", this.path("/actions"), {
      actions: [
        {
          type: "key",
          id: "desktop-acceptance",
          actions: [
            ...keys.map((value) => ({ type: "keyDown", value })),
            ...[...keys].reverse().map((value) => ({ type: "keyUp", value })),
          ],
        },
      ],
    });
  }
  shortcut(key, shift = false) {
    const modifier = process.platform === "darwin" ? "\uE03D" : "\uE009";
    return this.chord(shift ? [modifier, "\uE008", key] : [modifier, key]);
  }
  row(name) {
    return this.execute(
      "return [...document.querySelectorAll('.workspace-tree-row')].some(e=>e.title===arguments[0])",
      name,
    );
  }
  clickRow(name) {
    return this.click(`.workspace-tree-row[title=${JSON.stringify(name)}]`);
  }
  handles() {
    return this.request("GET", this.path("/window/handles"));
  }
  switch(handle) {
    return this.request("POST", this.path("/window"), { handle });
  }
  async refresh() {
    const marker = `mozi-navigation-${Date.now()}`;
    await this.execute("document.title=arguments[0];return true", marker);
    await this.request("POST", this.path("/refresh"), {});
    // Embedded refresh returns before navigation starts. GET title uses a native
    // evaluation, so a result callback cannot be destroyed with the old document.
    await until(
      async () => (await this.request("GET", this.path("/title"))) !== marker,
      "Reload did not replace the old document",
      30_000,
    );
    await until(
      () =>
        this.execute(
          "return document.readyState==='complete' && !!window.__TAURI_INTERNALS__",
        ),
      "Reload did not initialize the application bridge",
      60_000,
    );
  }
  async screenshot(path) {
    const encoded = await this.request("GET", this.path("/screenshot"));
    await writeFile(path, Buffer.from(encoded, "base64"));
  }
  async quit() {
    if (this.session) {
      await this.request("DELETE", this.path(""));
      this.session = undefined;
    }
  }
}
