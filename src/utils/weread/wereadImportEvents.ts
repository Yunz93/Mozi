export interface WeReadImportDialogOptions {
  initialQuery?: string;
  bookIds?: string[];
}

type Handler = (options?: WeReadImportDialogOptions) => void;

let handler: Handler | null = null;

export function setWeReadImportDialogHandler(next: Handler | null): void {
  handler = next;
}

export function requestWeReadImportDialog(
  options?: WeReadImportDialogOptions,
): void {
  handler?.(options);
}
