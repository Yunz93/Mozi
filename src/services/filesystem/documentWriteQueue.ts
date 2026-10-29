import { getFileSystem } from "../../types/filesystem";

const pendingWrites = new Map<string, Promise<void>>();

/** 同一文件的保存与切换前写盘共用队列，防止旧快照最后落盘。 */
export async function acquireDocumentWrite(path: string): Promise<() => void> {
  const previous = pendingWrites.get(path);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingWrites.set(path, current);
  await previous;
  return () => {
    if (pendingWrites.get(path) === current) pendingWrites.delete(path);
    release();
  };
}

export async function writeDocumentFile(
  path: string,
  content: string,
): Promise<void> {
  const release = await acquireDocumentWrite(path);
  try {
    const fs = await getFileSystem();
    await fs.writeFile(path, content);
  } finally {
    release();
  }
}
