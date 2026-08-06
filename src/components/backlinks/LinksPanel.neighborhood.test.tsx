/** @vitest-environment happy-dom */

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  NeighborhoodGraph,
  layoutScatterPoints,
  shortenEdgeSegment,
} from "./LinksPanel";

describe("shortenEdgeSegment", () => {
  it("insets both ends along the segment", () => {
    const segment = shortenEdgeSegment(0, 0, 100, 0, 10, 5);
    expect(segment).toEqual({ x1: 10, y1: 0, x2: 95, y2: 0 });
  });

  it("returns null when insets consume the segment", () => {
    expect(shortenEdgeSegment(0, 0, 10, 0, 6, 6)).toBeNull();
  });
});

describe("layoutScatterPoints", () => {
  it("keeps the center id near the middle and includes all ids", () => {
    const center = "/vault/center.md";
    const points = layoutScatterPoints(
      [center, "/vault/a.md", "/vault/b.md"],
      200,
      160,
      center,
      { labeled: false },
    );
    expect(points).toHaveLength(3);
    const centerPoint = points.find((point) => point.id === center);
    expect(centerPoint?.x).toBeCloseTo(96, 0);
    expect(centerPoint?.y).toBeCloseTo(73.6, 0);
  });
});

describe("NeighborhoodGraph edges", () => {
  it("renders a spoke from the current note to each neighbor", () => {
    const { container } = render(
      <NeighborhoodGraph
        centerPath="/vault/notes/01-数据采集模块 PRD.md"
        nodes={[
          { path: "/vault/notes/00-具身智能开放平台完整 PRD.md", kind: "in" },
          { path: "/vault/notes/02-感知模块.md", kind: "out" },
        ]}
        showLabels
        width={720}
        height={480}
      />,
    );

    const edges = container.querySelectorAll("line.links-neighborhood-edge");
    expect(edges).toHaveLength(2);
    expect(
      container.querySelectorAll("line.links-neighborhood-edge.is-in"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll("line.links-neighborhood-edge.is-out"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll("circle.links-neighborhood-node"),
    ).toHaveLength(3);
  });

  it("still draws edges in the compact unlabeled graph", () => {
    const { container } = render(
      <NeighborhoodGraph
        centerPath="/vault/a.md"
        nodes={[{ path: "/vault/b.md", kind: "out" }]}
        showLabels={false}
        width={260}
        height={168}
      />,
    );

    expect(
      container.querySelectorAll("line.links-neighborhood-edge"),
    ).toHaveLength(1);
    expect(
      container.querySelector("line.links-neighborhood-edge.is-out"),
    ).toBeTruthy();
  });
});
