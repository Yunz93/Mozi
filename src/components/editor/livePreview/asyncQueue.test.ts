import { describe, expect, it, vi } from "vitest";
import { LivePreviewAsyncQueue } from "./asyncQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("LivePreviewAsyncQueue", () => {
  it("runs only one job per key and retains only the latest pending job", async () => {
    const queue = new LivePreviewAsyncQueue(4);
    const first = deferred();
    const started: string[] = [];
    queue.enqueue("same", async () => {
      started.push("first");
      await first.promise;
    });
    queue.enqueue("same", async () => {
      started.push("superseded");
    });
    queue.enqueue("same", async () => {
      started.push("latest");
    });
    expect(started).toEqual(["first"]);
    first.resolve();
    await settle();
    expect(started).toEqual(["first", "latest"]);
  });

  it("starts other keys even when the first pending key is already active", async () => {
    const queue = new LivePreviewAsyncQueue(2);
    const first = deferred();
    const second = deferred();
    const started: string[] = [];
    queue.enqueue("a", async () => {
      started.push("a");
      await first.promise;
    });
    queue.enqueue("a", async () => {
      started.push("a-next");
    });
    queue.enqueue("b", async () => {
      started.push("b");
      await second.promise;
    });
    queue.enqueue("c", async () => {
      started.push("c");
    });
    expect(started).toEqual(["a", "b"]);
    second.resolve();
    await settle();
    expect(started).toEqual(["a", "b", "c"]);
    first.resolve();
    await settle();
    expect(started).toContain("a-next");
  });

  it("cancels a same-key pending rerun without cancelling the running job", async () => {
    const queue = new LivePreviewAsyncQueue(2);
    const first = deferred();
    const pending = vi.fn(async () => undefined);
    queue.enqueue("same", () => first.promise);
    queue.enqueue("same", pending);
    queue.cancel("same");
    first.resolve();
    await settle();
    expect(pending).not.toHaveBeenCalled();
  });
});
