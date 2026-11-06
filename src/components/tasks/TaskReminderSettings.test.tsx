// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskReminderSettings } from "./TaskReminderSettings";

vi.mock("../../hooks/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../utils/platform", () => ({ isMacOSPlatform: () => false }));
afterEach(cleanup);

it("submits only the changed setting so a stale window cannot reset other preferences", () => {
  const onChange = vi.fn();
  render(
    <TaskReminderSettings
      preferences={{
        notifications: false,
        background: false,
        language: "zh-CN",
        macCalendar: false,
        calendarId: "",
      }}
      vaults={[]}
      busy={false}
      error={null}
      onClose={vi.fn()}
      onChange={onChange}
      onTest={vi.fn()}
      onRemove={vi.fn()}
      calendarError={null}
      calendarSyncedAt={null}
    />,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /tasks_systemNotifications/ }),
  );
  expect(onChange).toHaveBeenLastCalledWith({ notifications: true });
  fireEvent.click(screen.getByRole("checkbox", { name: /tasks_background/ }));
  expect(onChange).toHaveBeenLastCalledWith({ background: true });
});
