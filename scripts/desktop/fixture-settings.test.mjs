import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { seedSettingsOnUnload } from "./fixture-settings.mjs";

test("fixture wins over late app persistence at navigation, without replacing live storage APIs", () => {
  const data = new Map();
  const window = new EventTarget();
  const settings = { lastKnowledgeBasePath: "/fixture/vault" };
  const localStorage = {
    clear: () => data.clear(),
    setItem: (key, value) => data.set(key, value),
  };
  runInNewContext(`(${seedSettingsOnUnload.toString()})(settings)`, {
    window,
    localStorage,
    settings,
  });
  const setItem = localStorage.setItem;
  data.set(
    "markdown-press-settings",
    JSON.stringify({
      state: { settings: { lastKnowledgeBasePath: null } },
      version: 0,
    }),
  );
  window.dispatchEvent(new Event("beforeunload"));
  assert.deepEqual(JSON.parse(data.get("markdown-press-settings")), {
    state: { settings },
    version: 0,
  });
  assert.equal(localStorage.setItem, setItem);
  data.set("markdown-press-settings", "next document");
  window.dispatchEvent(new Event("beforeunload"));
  assert.equal(data.get("markdown-press-settings"), "next document");
});

test("WKWebView navigation seeds the fixture when beforeunload is skipped", () => {
  const data = new Map();
  const window = new EventTarget();
  const settings = { lastKnowledgeBasePath: "/fixture/vault" };
  const localStorage = {
    clear: () => data.clear(),
    setItem: (key, value) => data.set(key, value),
  };
  runInNewContext(`(${seedSettingsOnUnload.toString()})(settings)`, {
    window,
    localStorage,
    settings,
  });
  assert.deepEqual(JSON.parse(data.get("markdown-press-settings")), {
    state: { settings },
    version: 0,
  });
  data.set("markdown-press-settings", "late persistence");
  window.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(JSON.parse(data.get("markdown-press-settings")), {
    state: { settings },
    version: 0,
  });
  data.set("markdown-press-settings", "next document");
  window.dispatchEvent(new Event("beforeunload"));
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(data.get("markdown-press-settings"), "next document");
});
