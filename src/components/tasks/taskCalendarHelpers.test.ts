import { expect, it, vi } from "vitest";
import type { CalendarTask } from "../../types/taskCalendar";
import { findTaskRange, prepareTaskSourceVault } from "./taskCalendarHelpers";

it("locates a BOM-prefixed first task without changing UTF-16 offsets", () => {
  const line = "- [ ] 编辑😀 @2026-12-20";
  const task = { rawLine: line, start: 0 } as CalendarTask;
  expect(findTaskRange(line, task)).toEqual({ start: 0, end: line.length });
  expect(findTaskRange(`\uFEFF${line}\r\n${line}`, task)).toEqual({
    start: 0,
    end: line.length + 1,
  });
});

it("saves the old workspace before loading a different task vault", async () => {
  const calls: string[] = [];
  const flush = vi.fn(async () => {
    calls.push("save");
    return true;
  });
  const open = vi.fn(async (path: string) => {
    calls.push(path);
    return path;
  });
  expect(
    await prepareTaskSourceVault("/vault-B", "/vault-A", flush, open),
  ).toBe(true);
  expect(calls).toEqual(["save", "/vault-A"]);
  expect(open).toHaveBeenCalledWith("/vault-A", {
    silentSuccess: true,
    skipSampleNotes: true,
    restoreLastOpenedFile: false,
  });
});

it("keeps the current vault when saving fails and avoids reopening the same vault", async () => {
  const flush = vi.fn(async () => false);
  const open = vi.fn(async () => "/vault-A");
  expect(
    await prepareTaskSourceVault("/vault-B", "/vault-A", flush, open),
  ).toBe(false);
  expect(open).not.toHaveBeenCalled();
  flush.mockClear();
  expect(
    await prepareTaskSourceVault("/vault-A", "/vault-A/", flush, open),
  ).toBe(true);
  expect(flush).not.toHaveBeenCalled();
});
