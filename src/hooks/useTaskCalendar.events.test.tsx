/** @vitest-environment happy-dom */

import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(async () => vi.fn()),
  reload: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "file-1" }),
}));
vi.mock("../types/filesystem", () => ({ isTauriEnvironment: () => true }));
vi.mock("../store/taskCalendarStore", () => ({
  useTaskCalendarStore: {
    getState: () => ({ reload: mocks.reload }),
    setState: vi.fn(),
  },
}));
import { useTaskCalendar } from "./useTaskCalendar";

it("broadcasts calendar updates while opening only the addressed window", async () => {
  function Harness() {
    useTaskCalendar();
    return null;
  }
  const view = render(<Harness />);
  await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  expect(mocks.listen).toHaveBeenCalledWith(
    "task-calendar-changed",
    expect.any(Function),
    undefined,
  );
  expect(mocks.listen).toHaveBeenCalledWith(
    "task-calendar-open",
    expect.any(Function),
    { target: { kind: "WebviewWindow", label: "file-1" } },
  );
  view.unmount();
});
