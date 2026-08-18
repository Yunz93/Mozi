export interface PaletteCommand {
  id: string;
  title: string;
  group: string;
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function haystack(command: PaletteCommand): string {
  return [command.title, command.group, command.keywords ?? "", command.id]
    .join(" ")
    .toLowerCase();
}

export function filterPaletteCommands(
  commands: PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const needle = normalizeQuery(query);
  if (!needle) return commands;

  const scored = commands
    .map((command) => {
      const text = haystack(command);
      const title = command.title.toLowerCase();
      let score = 0;
      if (title === needle) score = 100;
      else if (title.startsWith(needle)) score = 80;
      else if (title.includes(needle)) score = 60;
      else if (text.includes(needle)) score = 40;
      else return null;
      return { command, score };
    })
    .filter((item): item is { command: PaletteCommand; score: number } =>
      Boolean(item),
    )
    .sort(
      (a, b) =>
        b.score - a.score || a.command.title.localeCompare(b.command.title),
    );

  return scored.map((item) => item.command);
}
