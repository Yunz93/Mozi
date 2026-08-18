import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import { isImeComposingEvent, isPlainEnterKey } from "../../utils/imeKeyboard";
import {
  filterPaletteCommands,
  type PaletteCommand,
} from "../../utils/commandPalette/filterCommands";

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(
    () => filterPaletteCommands(commands, query),
    [commands, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const node = listRef.current?.querySelector(
      `[data-palette-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const runCommand = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh] px-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("commandPalette_title")}
        className="ui-scaled w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-gray-950"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (isImeComposingEvent(event)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) =>
              matches.length === 0 ? 0 : (index + 1) % matches.length,
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) =>
              matches.length === 0
                ? 0
                : (index - 1 + matches.length) % matches.length,
            );
            return;
          }
          if (isPlainEnterKey(event)) {
            event.preventDefault();
            runCommand(matches[activeIndex]);
          }
        }}
      >
        <div className="border-b border-gray-200 p-3 dark:border-white/10">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("commandPalette_placeholder")}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
              {t("commandPalette_empty")}
            </p>
          ) : (
            matches.map((command, index) => (
              <button
                key={command.id}
                type="button"
                data-palette-index={index}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                  index === activeIndex
                    ? "bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100"
                    : "text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-white/5"
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {command.title}
                  </span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {command.group}
                  </span>
                </span>
                {command.shortcut ? (
                  <kbd className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 dark:border-white/15 dark:text-gray-400">
                    {command.shortcut}
                  </kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
