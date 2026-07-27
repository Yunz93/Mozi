/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from "vitest";
import {
  clearLivePreviewWikiCaches,
  invalidateLivePreviewWikiCachesForPath,
  livePreviewWikiCacheStatsForTest,
  seedLivePreviewWikiCachesForTest,
} from "./wiki";

describe("live preview wiki caches", () => {
  afterEach(() => {
    clearLivePreviewWikiCaches();
  });

  it("invalidates note entries for a target path and clears image failures", () => {
    seedLivePreviewWikiCachesForTest({
      noteKey: "note::src.md::vault/notes/Hello.md::Hello::light::nord::0",
      imageKey: "wiki::src.md::![[Keep.png]]",
      failedKey: "wiki::src.md::![[missing.png]]",
    });
    seedLivePreviewWikiCachesForTest({
      noteKey: "note::src.md::vault/other/Keep.md::Keep::light::nord::0",
    });

    invalidateLivePreviewWikiCachesForPath("vault/notes/Hello.md");

    const stats = livePreviewWikiCacheStatsForTest();
    expect(stats.notes).toBe(1);
    expect(stats.images).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it("treats theme/style as part of the note cache identity", () => {
    seedLivePreviewWikiCachesForTest({
      noteKey: "note::src.md::vault/notes/Hello.md::Hello::light::nord::0",
    });
    seedLivePreviewWikiCachesForTest({
      noteKey: "note::src.md::vault/notes/Hello.md::Hello::dark::nord::0",
    });
    expect(livePreviewWikiCacheStatsForTest().notes).toBe(2);
  });
});
