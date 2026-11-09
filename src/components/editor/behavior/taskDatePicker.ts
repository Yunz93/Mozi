import {
  Prec,
  StateEffect,
  StateField,
  type EditorState,
} from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  EditorView,
  keymap,
  showTooltip,
  type Tooltip,
  type TooltipView,
} from "@codemirror/view";
import { useAppStore } from "../../../store/appStore";
import { localDateKey } from "../../tasks/taskCalendarHelpers";
import { t } from "../../../utils/i18n";
import { isImeComposingEvent } from "../../../utils/imeKeyboard";
import { isInsideFencedCode, isWithinFrontmatterBlock } from "./core";
import { isEditorImeComposing } from "./imeGuard";

interface TaskDateRange {
  from: number;
  to: number;
  date: Date;
  separator: string;
  time: string;
}

export const closeTaskDatePicker = StateEffect.define<void>();

function taskDateRange(state: EditorState): TaskDateRange | null {
  if (
    !state.selection.main.empty ||
    state.selection.ranges.length !== 1 ||
    state.readOnly
  )
    return null;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  if (
    !/^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[[ xX]\][ \t]+/.test(
      line.text,
    )
  )
    return null;
  if (isWithinFrontmatterBlock(state, pos) || isInsideFencedCode(state, pos))
    return null;
  const before = line.text.slice(0, pos - line.from);
  const match = /@(\d{0,4}(?:-\d{0,2}(?:-\d{0,2})?)?)$/.exec(before);
  if (!match) return null;
  const from = pos - match[1].length - 1;
  for (
    let node = syntaxTree(state).resolveInner(from + 1, -1);
    node;
    node = node.parent!
  ) {
    if (
      /^(InlineCode|FencedCode|CodeBlock|Link|Image|Autolink|URL|HTMLBlock|HTMLTag)$/.test(
        node.name,
      )
    )
      return null;
  }
  const tail = line.text.slice(pos - line.from).match(/^[\d-]*/)?.[0] ?? "";
  const after = line.text.slice(pos - line.from + tail.length);
  if (after && !/^\s/.test(after)) return null;
  const rawDate = match[1] + tail;
  const existingTime = /^\s+(\d{2}:\d{2})(?=\s|$)/.exec(after);
  const parts = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(rawDate);
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3] || 1))
    : new Date();
  return {
    from,
    to: pos + tail.length + (existingTime?.[0].length ?? 0),
    date,
    separator: /\s/.test(state.sliceDoc(from - 1, from)) ? "" : " ",
    time: existingTime?.[1] ?? "",
  };
}

function createDatePicker(view: EditorView, range: TaskDateRange): TooltipView {
  const language = useAppStore.getState().settings.language;
  const dom = document.createElement("div");
  dom.className = "cm-task-date-picker";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", t(language, "tasks_chooseDate"));
  const title = document.createElement("strong");
  title.textContent = t(language, "tasks_chooseDate");
  const header = document.createElement("div");
  header.className = "cm-task-date-header";
  const monthLabel = document.createElement("span");
  monthLabel.setAttribute("aria-live", "polite");
  const grid = document.createElement("div");
  grid.className = "cm-task-date-grid";
  const footer = document.createElement("div");
  footer.className = "cm-task-date-footer";
  const timeLabel = document.createElement("div");
  timeLabel.className = "cm-task-time-field";
  timeLabel.setAttribute("role", "group");
  timeLabel.setAttribute("aria-label", t(language, "tasks_optionalTime"));
  timeLabel.textContent = t(language, "tasks_optionalTime");
  const timeControls = document.createElement("span");
  timeControls.className = "cm-task-time-controls";
  const timeSelect = (label: string, count: number) => {
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    for (let value = 0; value < count; value++) {
      const text = String(value).padStart(2, "0");
      const option = document.createElement("option");
      option.textContent = text;
      option.value = text;
      select.append(option);
    }
    return select;
  };
  const hour = timeSelect(t(language, "tasks_hour"), 24);
  const allDay = document.createElement("option");
  allDay.textContent = t(language, "tasks_allDay");
  allDay.value = "";
  hour.prepend(allDay);
  const minute = timeSelect(t(language, "tasks_minute"), 60);
  const existingTime = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(range.time);
  hour.value = existingTime?.[1] ?? "";
  minute.value = existingTime?.[2] ?? "00";
  minute.disabled = !hour.value;
  hour.addEventListener("change", () => {
    minute.disabled = !hour.value;
  });
  const separator = document.createElement("span");
  separator.textContent = ":";
  separator.setAttribute("aria-hidden", "true");
  timeControls.append(hour, separator, minute);
  timeLabel.append(timeControls);
  let month = new Date(range.date.getFullYear(), range.date.getMonth(), 1);

  const close = (restoreFocus = false) => {
    view.dispatch({ effects: closeTaskDatePicker.of() });
    if (restoreFocus) view.focus();
  };
  const choose = (date: Date) => {
    if (isEditorImeComposing(view)) return;
    // 日期标记与任务正文之间需要空格，保证保存后可被日程索引识别。
    const time = hour.value ? ` ${hour.value}:${minute.value}` : "";
    const insert = `${range.separator}@${localDateKey(date)}${time}`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
      effects: closeTaskDatePicker.of(),
      annotations: isolateHistory.of("full"),
      userEvent: "input.complete",
      scrollIntoView: true,
    });
    view.focus();
  };
  const button = (label: string, action: () => void, text = label) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    element.setAttribute("aria-label", label);
    element.addEventListener("click", action);
    return element;
  };
  const paint = () => {
    monthLabel.textContent = new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "long",
    }).format(month);
    grid.replaceChildren();
    const first = new Date(month);
    first.setDate(1 - ((first.getDay() + 6) % 7));
    const weekdays = new Intl.DateTimeFormat(language, { weekday: "narrow" });
    const dayLabel = new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    for (let day = 0; day < 7; day++) {
      const label = document.createElement("span");
      const date = new Date(first);
      date.setDate(date.getDate() + day);
      label.textContent = weekdays.format(date);
      grid.appendChild(label);
    }
    for (let offset = 0; offset < 42; offset++) {
      const date = new Date(first);
      date.setDate(date.getDate() + offset);
      const day = button(
        dayLabel.format(date),
        () => choose(date),
        String(date.getDate()),
      );
      day.dataset.date = localDateKey(date);
      day.classList.toggle(
        "is-outside-month",
        date.getMonth() !== month.getMonth(),
      );
      const selected = localDateKey(date) === localDateKey(range.date);
      day.setAttribute("aria-pressed", String(selected));
      day.tabIndex =
        selected ||
        (date.getDate() === 1 && date.getMonth() === month.getMonth())
          ? 0
          : -1;
      if (localDateKey(date) === localDateKey(new Date()))
        day.setAttribute("aria-current", "date");
      day.addEventListener("keydown", (event) => {
        const delta = {
          ArrowLeft: -1,
          ArrowRight: 1,
          ArrowUp: -7,
          ArrowDown: 7,
        }[event.key];
        if (!delta || isImeComposingEvent(event)) return;
        event.preventDefault();
        const target = new Date(date);
        target.setDate(target.getDate() + delta);
        if (
          target.getMonth() !== month.getMonth() ||
          target.getFullYear() !== month.getFullYear()
        ) {
          month = new Date(target.getFullYear(), target.getMonth(), 1);
          paint();
        }
        grid
          .querySelector<HTMLButtonElement>(
            `[data-date="${localDateKey(target)}"]`,
          )
          ?.focus();
      });
      grid.appendChild(day);
    }
  };
  const moveMonth = (delta: number) => {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    paint();
  };
  header.append(
    button(t(language, "tasks_previousMonth"), () => moveMonth(-1), "‹"),
    monthLabel,
    button(t(language, "tasks_nextMonth"), () => moveMonth(1), "›"),
  );
  footer.append(
    button(t(language, "tasks_today"), () => choose(new Date())),
    button(t(language, "tasks_tomorrow"), () => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      choose(date);
    }),
    button(t(language, "common_cancel"), () => close(true)),
  );
  dom.append(title, header, grid, timeLabel, footer);
  // 鼠标选日期时保留正文的焦点与光标，键盘仍可进入日期按钮。
  dom.addEventListener("mousedown", (event) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest("input, select, textarea")
    )
      event.preventDefault();
  });
  dom.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      isImeComposingEvent(event) ||
      isEditorImeComposing(view)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  });
  const outside = (event: Event) => {
    if (
      event.target instanceof Node &&
      !dom.contains(event.target) &&
      !view.contentDOM.contains(event.target)
    )
      close();
  };
  paint();
  return {
    dom,
    mount() {
      document.addEventListener("mousedown", outside, true);
      // 原生下拉获得焦点前，WKWebView 会暂时把活动元素设为 BODY。
      // 只在新焦点明确进入面板及正文外的控件时关闭，不能按临时失焦判断。
      document.addEventListener("focusin", outside);
    },
    destroy() {
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("focusin", outside);
    },
  };
}

const taskDateTooltip = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, transaction) {
    if (
      transaction.state.readOnly ||
      transaction.effects.some((effect) => effect.is(closeTaskDatePicker))
    )
      return null;
    if (!transaction.docChanged) return transaction.selection ? null : value;
    // 外部内容刷新、撤销和重做不应弹出输入提示。
    if (!transaction.isUserEvent("input.type")) return null;
    const range = taskDateRange(transaction.state);
    return range
      ? {
          pos: range.from,
          end: range.to,
          create: (view) => createDatePicker(view, range),
        }
      : null;
  },
  provide: (field) => showTooltip.from(field),
});

const datePickerTheme = EditorView.baseTheme({
  ".cm-tooltip.cm-task-date-picker": {
    width: "min(284px, calc(100vw - 24px))",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid var(--workspace-border, #ded9d0)",
    background: "var(--workspace-menu, #fffdf8)",
    color: "var(--workspace-text, #2c2b28)",
    boxShadow: "0 12px 32px rgba(0,0,0,.18)",
    font: "13px/1.5 var(--app-ui-font-family, system-ui)",
  },
  ".cm-task-date-picker strong": {
    display: "block",
    marginBottom: "8px",
    fontWeight: "600",
  },
  ".cm-task-date-header, .cm-task-date-footer": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  ".cm-task-date-header": { marginBottom: "8px" },
  ".cm-task-date-grid": {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    gap: "2px",
    textAlign: "center",
  },
  ".cm-task-date-grid > span": {
    color: "var(--workspace-muted, #746f67)",
    fontSize: "11px",
    padding: "4px 0",
  },
  ".cm-task-date-picker button": {
    border: "none",
    borderRadius: "6px",
    minHeight: "32px",
    padding: "4px 6px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-task-date-picker button:hover": {
    background: "var(--workspace-hover, #eae5dc)",
  },
  ".cm-task-date-picker button:focus-visible": {
    outline: "2px solid var(--workspace-accent, #a65f43)",
    outlineOffset: "-2px",
  },
  ".cm-task-date-picker .is-outside-month": {
    color: "var(--workspace-muted, #746f67)",
    opacity: ".6",
  },
  ".cm-task-date-picker button[aria-current=date]": {
    color: "var(--workspace-accent, #a65f43)",
    fontWeight: "600",
  },
  ".cm-task-date-picker button[aria-pressed=true]": {
    background: "var(--workspace-active, #f1e3d9)",
    color: "var(--workspace-accent, #a65f43)",
  },
  ".cm-task-date-footer": {
    marginTop: "8px",
    paddingTop: "8px",
    borderTop: "1px solid var(--workspace-border, #ded9d0)",
  },
  ".cm-task-time-field": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "8px",
    gap: "8px",
    color: "var(--workspace-muted)",
  },
  ".cm-task-time-controls": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  ".cm-task-time-field select": {
    font: "inherit",
    color: "var(--workspace-text)",
    background: "var(--workspace-menu)",
    border: "1px solid var(--workspace-border)",
    borderRadius: "6px",
    padding: "4px 6px",
    minHeight: "32px",
    minWidth: "54px",
    cursor: "pointer",
  },
  ".cm-task-time-field select:focus-visible": {
    outline: "2px solid var(--workspace-accent)",
    outlineOffset: "1px",
  },
  ".cm-task-time-field select:disabled": {
    opacity: ".5",
    cursor: "default",
  },
});

export const taskDatePickerExtension = [
  taskDateTooltip,
  datePickerTheme,
  // 日期浮层先于补全处理 Escape，避免只取消待定补全而留下日期浮层。
  Prec.highest(
    keymap.of([
      {
        key: "Escape",
        stopPropagation: true,
        run(view) {
          if (!view.state.field(taskDateTooltip) || isEditorImeComposing(view))
            return false;
          view.dispatch({ effects: closeTaskDatePicker.of() });
          return true;
        },
      },
    ]),
  ),
];
