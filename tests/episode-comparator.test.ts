/**
 * Tests for episode-comparator.ts
 * Covers computeTrendingProducts and compareEpisodes — previously untested.
 */

import { describe, it, expect } from "vitest";
import {
  computeTrendingProducts,
  compareEpisodes,
} from "../src/episode-comparator.js";

function makeProduct(name: string, strength: string) {
  return {
    name,
    category: "supplement",
    recommendation_strength: strength,
    confidence: 0.9,
    speaker: "host" as const,
    mention_context: `context for ${name}`,
    affiliate_link: null,
    mention_count: 1,
  };
}

function makeEp(id: string, products: ReturnType<typeof makeProduct>[]) {
  return {
    episode_id: id,
    products,
    sponsor_segments: [],
    _meta: { processing_time_ms: 100, ai_cost_usd: 0.001, cache_hit: false },
  };
}

describe("computeTrendingProducts", () => {
  it("returns empty array for no episodes", () => {
    expect(computeTrendingProducts([])).toEqual([]);
  });

  it("avg_recommendation_strength is finite for single episode", () => {
    const result = computeTrendingProducts([makeEp("ep1", [makeProduct("AG1", "strong")])]);
    expect(result).toHaveLength(1);
    expect(Number.isFinite(result[0]!.avg_recommendation_strength)).toBe(true);
    expect(result[0]!.avg_recommendation_strength).toBe(3); // strong = 3
  });

  it("avg_recommendation_strength is finite for multi-episode products", () => {
    const eps = [
      makeEp("ep1", [makeProduct("AG1", "strong")]),   // 3
      makeEp("ep2", [makeProduct("AG1", "moderate")]), // 2
    ];
    const result = computeTrendingProducts(eps);
    expect(result).toHaveLength(1);
    expect(result[0]!.mention_count).toBe(2);
    expect(Number.isFinite(result[0]!.avg_recommendation_strength)).toBe(true);
    expect(result[0]!.avg_recommendation_strength).toBe(2.5); // (3+2)/2
  });

  it("sorts by mention_count descending", () => {
    const eps = [
      makeEp("ep1", [makeProduct("AG1", "strong"), makeProduct("Oura", "mention")]),
      makeEp("ep2", [makeProduct("AG1", "moderate")]),
    ];
    const result = computeTrendingProducts(eps);
    expect(result[0]!.name).toBe("AG1");
    expect(result[0]!.mention_count).toBe(2);
  });
});

describe("compareEpisodes", () => {
  it("returns empty result for no episodes", () => {
    const r = compareEpisodes([], "all");
    expect(r.new_products).toHaveLength(0);
    expect(r.dropped_products).toHaveLength(0);
  });

  it("identifies products new to the latest episode", () => {
    const eps = [
      makeEp("ep1", [makeProduct("AG1", "strong")]),
      makeEp("ep2", [makeProduct("Oura", "moderate")]),
    ];
    const r = compareEpisodes(eps, "new_in_latest");
    expect(r.new_products).toContain("Oura");
    expect(r.dropped_products).toHaveLength(0);
  });
});
