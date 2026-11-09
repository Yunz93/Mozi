export const FILE_METADATA_CHANGED_EVENT = "mozi-file-metadata-changed";

export function invalidateFileMetadata(paths: string[]): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(FILE_METADATA_CHANGED_EVENT, { detail: paths }),
    );
  }
}
