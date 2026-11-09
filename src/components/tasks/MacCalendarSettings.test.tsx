// @vitest-environment happy-dom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MacCalendarAccess } from "../../types/taskCalendar";
import { MacCalendarSettings } from "./MacCalendarSettings";
import { getMacCalendarAccess } from "../../services/taskCalendarService";

vi.mock("../../hooks/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../services/taskCalendarService", () => ({
  getMacCalendarAccess: vi.fn(),
}));
const granted: MacCalendarAccess = {
  supported: true,
  permission: "granted",
  calendars: [{ id: "saved-calendar", title: "Saved calendar", source: "" }],
  defaultCalendarId: "saved-calendar",
};
const props = {
  preferences: {
    notifications: false,
    background: false,
    language: "zh-CN",
    macCalendar: true,
    calendarId: "saved-calendar",
  },
  busy: false,
  syncError: null,
  syncedAt: null,
  onChange: vi.fn(),
} as const;
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("restores an enabled saved calendar without reporting unavailable while loading or requesting permission", async () => {
  let resolve!: (access: MacCalendarAccess) => void;
  vi.mocked(getMacCalendarAccess).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<MacCalendarSettings {...props} />);
  expect(screen.queryByText("tasks_calendarUnavailable")).toBeNull();
  expect(screen.queryByText("tasks_calendarPermissionHint")).toBeNull();
  await act(async () => resolve(granted));
  expect(await screen.findByText("Saved calendar")).toBeTruthy();
  expect(getMacCalendarAccess).toHaveBeenCalledWith();
  expect(props.onChange).not.toHaveBeenCalled();
});

it("still reports a genuinely missing target after a granted list finishes loading", async () => {
  vi.mocked(getMacCalendarAccess).mockResolvedValue({
    ...granted,
    calendars: [],
  });
  render(<MacCalendarSettings {...props} />);
  expect(await screen.findByText("tasks_calendarUnavailable")).toBeTruthy();
});

it("reports denied permission without also labelling the saved calendar deleted", async () => {
  vi.mocked(getMacCalendarAccess).mockResolvedValue({
    ...granted,
    permission: "denied",
    calendars: [],
  });
  render(<MacCalendarSettings {...props} />);
  await waitFor(() =>
    expect(screen.getByText("tasks_calendarPermissionHint")).toBeTruthy(),
  );
  expect(screen.queryByText("tasks_calendarUnavailable")).toBeNull();
  expect(props.onChange).not.toHaveBeenCalled();
});

it("keeps a newer granted response when an earlier startup query returns late", async () => {
  let resolveOld!: (access: MacCalendarAccess) => void;
  let resolveNew!: (access: MacCalendarAccess) => void;
  vi.mocked(getMacCalendarAccess)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolveOld = done;
      }),
    )
    .mockReturnValueOnce(
      new Promise((done) => {
        resolveNew = done;
      }),
    );
  render(<MacCalendarSettings {...props} />);
  fireEvent(window, new Event("focus"));
  await act(async () => resolveNew(granted));
  expect(screen.getByText("Saved calendar")).toBeTruthy();
  await act(async () =>
    resolveOld({ ...granted, permission: "denied", calendars: [] }),
  );
  expect(screen.getByText("Saved calendar")).toBeTruthy();
  expect(screen.queryByText("tasks_calendarPermissionHint")).toBeNull();
});

it("keeps explicit authorization and target selection intact when the app regains focus", async () => {
  let resolve!: (access: MacCalendarAccess) => void;
  vi.mocked(getMacCalendarAccess)
    .mockResolvedValueOnce({
      ...granted,
      permission: "notDetermined",
      calendars: [],
    })
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
  render(
    <MacCalendarSettings
      {...props}
      preferences={{ ...props.preferences, macCalendar: false, calendarId: "" }}
    />,
  );
  const toggle = screen.getByRole("checkbox");
  await waitFor(() =>
    expect((toggle as HTMLInputElement).disabled).toBe(false),
  );
  fireEvent.click(toggle);
  fireEvent(window, new Event("focus"));
  expect(getMacCalendarAccess).toHaveBeenCalledTimes(2);
  expect(getMacCalendarAccess).toHaveBeenLastCalledWith(true);
  await act(async () => resolve(granted));
  expect(screen.getByText("Saved calendar")).toBeTruthy();
  expect(props.onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "tasks_calendarStart" }));
  expect(props.onChange).toHaveBeenCalledWith({
    macCalendar: true,
    calendarId: "saved-calendar",
  });
});

it("reports a failed calendar query as retryable and does not leave an endless loading or missing-target state", async () => {
  vi.mocked(getMacCalendarAccess).mockRejectedValueOnce(
    new Error("Calendar connection failed"),
  );
  render(<MacCalendarSettings {...props} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Calendar connection failed",
  );
  expect(screen.queryByText("tasks_calendarUnavailable")).toBeNull();
  expect(screen.queryByText("tasks_syncing")).toBeNull();
  vi.mocked(getMacCalendarAccess).mockResolvedValue(granted);
  fireEvent.click(
    screen.getByRole("button", { name: "tasks_calendarRefresh" }),
  );
  expect(await screen.findByText("Saved calendar")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(props.onChange).not.toHaveBeenCalled();
});
