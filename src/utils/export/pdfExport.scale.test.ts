import { describe, it, expect } from "vitest";
import {
  computeSafeLongImageRenderScale,
  computeSafePdfRenderScale,
  LONG_IMAGE_MAX_CANVAS_DIMENSION,
} from "./exportRasterHost";

describe("computeSafePdfRenderScale", () => {
  const SAFE_LIMIT = 14000;

  it("returns the requested scale for short documents that fit comfortably", () => {
    const scale = computeSafePdfRenderScale(832, 4000, 2.5);
    expect(scale).toBeCloseTo(2.5, 5);
  });

  it("clamps the scale when the height-side canvas would exceed the safe limit", () => {
    // 832 wide, 8000 tall, scale 2.5 -> 20000px canvas height: must clamp.
    const scale = computeSafePdfRenderScale(832, 8000, 2.5);
    expect(scale).toBeLessThan(2.5);
    expect(scale * 8000).toBeLessThanOrEqual(SAFE_LIMIT + 1e-6);
  });

  it("keeps the worst-case canvas dimension under the limit even for very long docs", () => {
    // 832 wide, 24000 tall, scale 2.5 -> 60000px canvas height (would crash on Windows WebView2).
    const containerWidth = 832;
    const containerHeight = 24000;
    const scale = computeSafePdfRenderScale(
      containerWidth,
      containerHeight,
      2.5,
    );
    const worstDimension = Math.max(
      containerWidth * scale,
      containerHeight * scale,
    );
    expect(worstDimension).toBeLessThanOrEqual(SAFE_LIMIT + 1e-6);
  });

  it("clamps the worst-case canvas dimension under the limit even for very long docs", () => {
    // Container 832 wide, 24000 tall: scale 1 still produces a 24000px canvas
    // which exceeds the cap, so the helper must drop below 1 to stay safe.
    const containerWidth = 832;
    const containerHeight = 24000;
    const scale = computeSafePdfRenderScale(
      containerWidth,
      containerHeight,
      2.5,
    );
    const worstDimension = Math.max(
      containerWidth * scale,
      containerHeight * scale,
    );
    expect(worstDimension).toBeLessThanOrEqual(SAFE_LIMIT + 1e-6);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0.5);
  });

  it("rejects documents that cannot fit at the minimum readable scale", () => {
    expect(() => computeSafePdfRenderScale(832, 200_000)).toThrow(
      /too large.*split/i,
    );
    expect(() => computeSafePdfRenderScale(832, Number.MAX_VALUE)).toThrow(
      /too large.*split/i,
    );
    expect(() => computeSafePdfRenderScale(200_000, 832)).toThrow(
      /too large.*split/i,
    );
  });

  it("accepts the exact readable-size boundary and rejects the next pixel", () => {
    expect(computeSafePdfRenderScale(832, 140_000)).toBe(0.1);
    expect(() => computeSafePdfRenderScale(832, 140_001)).toThrow(/too large/i);
  });

  it.each([0, -0, -1, NaN, Infinity, -Infinity])(
    "rejects invalid dimensions or limits: %s",
    (invalid) => {
      expect(() => computeSafePdfRenderScale(invalid, 1000)).toThrow(
        /invalid/i,
      );
      expect(() => computeSafePdfRenderScale(832, invalid)).toThrow(/invalid/i);
      expect(() => computeSafePdfRenderScale(832, 1000, invalid)).toThrow(
        /invalid/i,
      );
      expect(() => computeSafePdfRenderScale(832, 1000, 2.5, invalid)).toThrow(
        /invalid/i,
      );
    },
  );

  it("respects an explicit max-canvas-dimension override", () => {
    const scale = computeSafePdfRenderScale(832, 8000, 2.5, 8000);
    expect(scale * 8000).toBeLessThanOrEqual(8000 + 1e-6);
  });
});

describe("computeSafeLongImageRenderScale", () => {
  it("keeps long image exports crisp on non-Windows platforms", () => {
    const scale = computeSafeLongImageRenderScale(832, 8000, 2.5, "mac");
    expect(scale).toBeCloseTo(2.5, 5);
  });

  it("uses the lower WebView2-safe cap on Windows", () => {
    const scale = computeSafeLongImageRenderScale(832, 8000, 2.5, "windows");
    expect(scale).toBeLessThan(2.5);
    expect(scale * 8000).toBeLessThanOrEqual(14000 + 1e-6);
  });

  it("still caps very long non-Windows images before exceeding the long-image limit", () => {
    const scale = computeSafeLongImageRenderScale(832, 24000, 2.5, "mac");
    expect(scale * 24000).toBeLessThanOrEqual(
      LONG_IMAGE_MAX_CANVAS_DIMENSION + 1e-6,
    );
    expect(scale).toBeGreaterThan(1);
  });

  it("uses the platform limit to reject an unexportable image", () => {
    expect(computeSafeLongImageRenderScale(832, 300_000, 2.5, "mac")).toBe(0.1);
    expect(() =>
      computeSafeLongImageRenderScale(832, 300_001, 2.5, "mac"),
    ).toThrow(/too large.*split/i);
    expect(() =>
      computeSafeLongImageRenderScale(832, 140_001, 2.5, "windows"),
    ).toThrow(/too large.*split/i);
  });
});
