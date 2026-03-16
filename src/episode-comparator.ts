/**
 * Episode Comparator — compare product mentions across podcast episodes.
 *
 * Supports four comparison modes:
 * - new_in_latest: products in the most recent episode not in earlier ones
 * - disappeared: products in earlier episodes not in the most recent
 * - consistent: products appearing in all episodes
 * - all: full diff across all episodes
 */

import type { EpisodeExtraction, TrendingProduct, ProductCategory } from "./types.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Numeric weight for recommendation_strength values used in avg computation. */
const STRENGTH_RANK: Record<string, number> = {
  strong: 3, moderate: 2, mention: 1, negative: 0,
};

// ============================================================================
// COMPARISON RESULT
// ============================================================================

export interface ComparisonResult {
  new_products: string[];
  dropped_products: string[];
  consistent_products: string[];
  category_shifts: Record<string, number>;
}

// ============================================================================
// HELPERS
// ============================================================================

function getProductNames(episode: EpisodeExtraction): Set<string> {
  return new Set(episode.products.map((p) => p.name.toLowerCase()));
}

function buildCategoryBreakdown(episodes: EpisodeExtraction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const episode of episodes) {
    for (const product of episode.products) {
      counts[product.category] = (counts[product.category] ?? 0) + 1;
    }
  }
  return counts;
}

// ============================================================================
// COMPARATOR
// ============================================================================

/**
 * Compare product mentions across episodes.
 *
 * @param episodes - Array of EpisodeExtraction objects (2-5 episodes)
 * @param mode - Comparison mode
 * @returns ComparisonResult with categorized product name sets
 */
export function compareEpisodes(
  episodes: EpisodeExtraction[],
  mode: "new_in_latest" | "disappeared" | "consistent" | "all",
): ComparisonResult {
  if (episodes.length === 0) {
    return {
      new_products: [],
      dropped_products: [],
      consistent_products: [],
      category_shifts: {},
    };
  }

  if (episodes.length === 1) {
    const ep = episodes[0];
    const allNames = ep ? ep.products.map((p) => p.name) : [];
    return {
      new_products: allNames,
      dropped_products: [],
      consistent_products: allNames,
      category_shifts: buildCategoryBreakdown(episodes),
    };
  }

  // Latest episode is last in the array
  const latestEp = episodes[episodes.length - 1];
  const earlierEps = episodes.slice(0, -1);

  if (!latestEp) {
    return {
      new_products: [],
      dropped_products: [],
      consistent_products: [],
      category_shifts: {},
    };
  }

  const latestNames = getProductNames(latestEp);

  // Union of all names in earlier episodes
  const earlierUnion = new Set<string>();
  for (const ep of earlierEps) {
    for (const name of getProductNames(ep)) {
      earlierUnion.add(name);
    }
  }

  // Intersection of all episode name sets (consistent across all)
  let consistentNames = new Set<string>(latestNames);
  for (const ep of earlierEps) {
    const epNames = getProductNames(ep);
    for (const name of consistentNames) {
      if (!epNames.has(name)) {
        consistentNames.delete(name);
      }
    }
  }

  // New in latest: in latest but not in any earlier episode
  const newProductNames: string[] = [];
  for (const name of latestNames) {
    if (!earlierUnion.has(name)) {
      // Find original casing
      const original = latestEp.products.find((p) => p.name.toLowerCase() === name);
      if (original) newProductNames.push(original.name);
    }
  }

  // Dropped: in earlier episodes but not in latest
  const droppedProductNames: string[] = [];
  for (const name of earlierUnion) {
    if (!latestNames.has(name)) {
      // Find original casing from any earlier episode
      for (const ep of earlierEps) {
        const original = ep.products.find((p) => p.name.toLowerCase() === name);
        if (original) {
          droppedProductNames.push(original.name);
          break;
        }
      }
    }
  }

  // Consistent: in all episodes
  const consistentProductNames: string[] = [];
  for (const name of consistentNames) {
    const original = latestEp.products.find((p) => p.name.toLowerCase() === name);
    if (original) consistentProductNames.push(original.name);
  }

  const categoryShifts = buildCategoryBreakdown(episodes);

  const result: ComparisonResult = {
    new_products: newProductNames,
    dropped_products: droppedProductNames,
    consistent_products: consistentProductNames,
    category_shifts: categoryShifts,
  };

  // Filter based on mode
  if (mode === "new_in_latest") {
    result.dropped_products = [];
    result.consistent_products = [];
  } else if (mode === "disappeared") {
    result.new_products = [];
    result.consistent_products = [];
  } else if (mode === "consistent") {
    result.new_products = [];
    result.dropped_products = [];
  }
  // mode === "all" returns everything

  return result;
}

// ============================================================================
// TRENDING PRODUCTS
// ============================================================================

/**
 * Compute trending products across multiple episodes.
 *
 * A product is "trending" if it appears in multiple episodes.
 * Returns products sorted by mention_count descending.
 *
 * @param episodes - Array of EpisodeExtraction objects
 * @returns Array of TrendingProduct sorted by mention_count desc
 */
export function computeTrendingProducts(
  episodes: EpisodeExtraction[],
): TrendingProduct[] {
  const productMap = new Map<
    string,
    {
      name: string;
      category: ProductCategory;
      mention_count: number;
      total_strength: number;
      episodes: Set<string>;
    }
  >();

  for (const episode of episodes) {
    for (const product of episode.products) {
      const key = product.name.toLowerCase();
      const existing = productMap.get(key);
      if (existing) {
        existing.mention_count += 1;
        existing.total_strength += STRENGTH_RANK[product.recommendation_strength] ?? 1;
        existing.episodes.add(episode.episode_id);
      } else {
        productMap.set(key, {
          name: product.name,
          category: product.category,
          mention_count: 1,
          total_strength: STRENGTH_RANK[product.recommendation_strength] ?? 1,
          episodes: new Set([episode.episode_id]),
        });
      }
    }
  }

  return [...productMap.values()]
    .map((p) => ({
      name: p.name,
      category: p.category,
      mention_count: p.mention_count,
      avg_recommendation_strength:
        p.mention_count > 0
          ? Math.round((p.total_strength / p.mention_count) * 100) / 100
          : 0,
      episodes: [...p.episodes],
    }))
    .sort((a, b) => b.mention_count - a.mention_count);
}
