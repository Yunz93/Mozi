// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const loaded = new Set<string>();
  const js = vi.fn(async () => ({ default: { name: "javascript" } }));
  const py = vi.fn(async () => ({ default: { name: "python" } }));
  const unused = vi.fn(async () => ({ default: { name: "rust" } }));
  const loadLanguage = vi.fn(
    async (loader: () => Promise<{ default: { name: string } }>) => {
      loaded.add((await loader()).default.name);
    },
  );
  const create = vi.fn(async ({ langs }: { langs: { name: string }[] }) => {
    for (const lang of langs) loaded.add(lang.name);
    return {
      codeToHtml: () => "<pre class='shiki'></pre>",
      getLoadedLanguages: () => [...loaded],
      loadLanguage,
    };
  });
  return { create, loaded, js, py, unused, loadLanguage };
});
vi.mock("shiki/core", () => ({ createHighlighterCore: mock.create }));
vi.mock("shiki/engine/javascript", () => ({
  createJavaScriptRegexEngine: () => ({}),
}));
vi.mock("shiki/langs", () => ({
  bundledLanguages: { javascript: mock.js, python: mock.py, rust: mock.unused },
}));
import { useShikiHighlighter } from "./useShikiHighlighter";
afterEach(cleanup);

it("loads no engine for plain/diagram notes, then loads only needed languages and reuses them", async () => {
  const hook = renderHook(({ content }) => useShikiHighlighter(content), {
    initialProps: { content: "# Plain note" },
  });
  await act(async () => {});
  expect(hook.result.current.highlighter).toBeNull();
  expect(mock.create).not.toHaveBeenCalled();
  hook.rerender({ content: "```mermaid\ngraph LR; A-->B\n```" });
  await act(async () => {});
  expect(mock.create).not.toHaveBeenCalled();

  hook.rerender({ content: "```js\nconst x=1\n```" });
  await waitFor(() =>
    expect(hook.result.current.highlighter?.getLoadedLanguages?.()).toEqual([
      "javascript",
    ]),
  );
  expect(mock.create).toHaveBeenCalledTimes(1);
  expect(mock.js).toHaveBeenCalledTimes(1);
  expect(mock.py).not.toHaveBeenCalled();
  expect(mock.unused).not.toHaveBeenCalled();
  const revision = hook.result.current.highlighter!.__revision!;
  hook.rerender({ content: "```python\nprint('hello')\n```" });
  hook.rerender({ content: "```python\nprint('edited')\n```" });
  await waitFor(() =>
    expect(hook.result.current.highlighter?.getLoadedLanguages?.()).toContain(
      "python",
    ),
  );
  await waitFor(() =>
    expect(hook.result.current.highlighter!.__revision).toBeGreaterThan(
      revision,
    ),
  );
  expect(mock.loadLanguage).toHaveBeenCalledTimes(1);
  expect(mock.py).toHaveBeenCalledTimes(1);
  hook.rerender({ content: "# Plain again" });
  hook.rerender({ content: "```js\nconst cached=2\n```" });
  await act(async () => {});
  expect(mock.create).toHaveBeenCalledTimes(1);
  expect(mock.js).toHaveBeenCalledTimes(1);
  expect(mock.unused).not.toHaveBeenCalled();
});
