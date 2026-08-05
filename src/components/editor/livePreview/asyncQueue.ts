/**
 * Bounded async work queue for Live Preview image / wiki resolves.
 * Limits concurrency and drops superseded jobs for the same cache key.
 */

type Job = () => Promise<void>;

interface QueuedJob {
  key: string;
  run: Job;
  generation: number;
}

export class LivePreviewAsyncQueue {
  private readonly pending = new Map<string, QueuedJob>();
  private readonly generations = new Map<string, number>();
  private readonly active = new Set<string>();
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  /** Enqueue work for `key`. Newer enqueue for the same key supersedes older. */
  enqueue(key: string, run: Job): void {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    this.pending.set(key, { key, run, generation });
    this.pump();
  }

  /** Cancel pending (not in-flight) work for a key. */
  cancel(key: string): void {
    this.pending.delete(key);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  clear(): void {
    this.pending.clear();
    for (const key of [...this.generations.keys()]) {
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    }
  }

  private pump(): void {
    while (this.active.size < this.maxConcurrent && this.pending.size > 0) {
      const next = this.pending.values().next().value as QueuedJob | undefined;
      if (!next) return;
      this.pending.delete(next.key);
      if (this.generations.get(next.key) !== next.generation) continue;
      this.active.add(next.key);
      void next
        .run()
        .catch(() => {})
        .finally(() => {
          this.active.delete(next.key);
          this.pump();
        });
    }
  }
}

export const livePreviewImageQueue = new LivePreviewAsyncQueue(4);
export const livePreviewWikiQueue = new LivePreviewAsyncQueue(4);
