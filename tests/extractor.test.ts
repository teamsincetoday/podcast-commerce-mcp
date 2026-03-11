/**
 * Unit tests for extractor.ts
 *
 * Mocks OpenAI — no real API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normalizeProducts, normalizeSponsorSegments, computeTrends, compareProductsAcrossShows } from "../src/extractor.js";
import type { ExtractionResult, OpenAIProductResponse } from "../src/types.js";

// ============================================================================
// normalizeProducts
// ============================================================================

describe("normalizeProducts", () => {
  it("returns empty array for empty input", () => {
    expect(normalizeProducts([])).toEqual([]);
  });

  it("normalizes a valid product entry", () => {
    const raw: OpenAIProductResponse["products"] = [
      {
        name: "Notion",
        category: "saas",
        mention_context: "I use Notion every day for notes",
        speaker: "Host",
        confidence: 0.9,
        recommendation_strength: "strong",
        affiliate_link: null,
      },
    ];

    const result = normalizeProducts(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Notion",
      category: "saas",
      confidence: 0.9,
      recommendation_strength: "strong",
      mention_count: 1,
    });
  });

  it("deduplicates products by name (case-insensitive)", () => {
    const raw: OpenAIProductResponse["products"] = [
      {
        name: "Athletic Greens",
        category: "physical_goods",
        mention_context: "first mention",
        speaker: null,
        confidence: 0.7,
        recommendation_strength: "mention",
        affiliate_link: null,
      },
      {
        name: "athletic greens",
        category: "physical_goods",
        mention_context: "second mention",
        speaker: null,
        confidence: 0.85,
        recommendation_strength: "strong",
        affiliate_link: "https://ag1.com/pod",
      },
    ];

    const result = normalizeProducts(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.mention_count).toBe(2);
    expect(result[0]?.confidence).toBe(0.85); // keeps highest
  });

  it("falls back to 'other' for unknown categories", () => {
    const raw: OpenAIProductResponse["products"] = [
      {
        name: "Mystery Product",
        category: "blockchain_thing",
        mention_context: "context",
        speaker: null,
        confidence: 0.5,
        recommendation_strength: "mention",
        affiliate_link: null,
      },
    ];

    const result = normalizeProducts(raw);
    expect(result[0]?.category).toBe("other");
  });

  it("clamps confidence to 0.0-1.0", () => {
    const raw: OpenAIProductResponse["products"] = [
      {
        name: "Overconfident Product",
        category: "saas",
        mention_context: "ctx",
        speaker: null,
        confidence: 1.5, // invalid
        recommendation_strength: "strong",
        affiliate_link: null,
      },
    ];

    const result = normalizeProducts(raw);
    expect(result[0]?.confidence).toBe(1.0);
  });

  it("sorts by confidence descending", () => {
    const raw: OpenAIProductResponse["products"] = [
      {
        name: "Low Conf",
        category: "other",
        mention_context: "ctx",
        speaker: null,
        confidence: 0.3,
        recommendation_strength: "mention",
        affiliate_link: null,
      },
      {
        name: "High Conf",
        category: "saas",
        mention_context: "ctx",
        speaker: null,
        confidence: 0.9,
        recommendation_strength: "strong",
        affiliate_link: null,
      },
    ];

    const result = normalizeProducts(raw);
    expect(result[0]?.name).toBe("High Conf");
    expect(result[1]?.name).toBe("Low Conf");
  });

  it("skips entries with empty name", () => {
    const raw: OpenAIProductResponse["products"] = [
      {
        name: "",
        category: "saas",
        mention_context: "ctx",
        speaker: null,
        confidence: 0.9,
        recommendation_strength: "strong",
        affiliate_link: null,
      },
    ];

    expect(normalizeProducts(raw)).toHaveLength(0);
  });
});

// ============================================================================
// normalizeSponsorSegments
// ============================================================================

describe("normalizeSponsorSegments", () => {
  it("returns empty array for empty input", () => {
    expect(normalizeSponsorSegments([])).toEqual([]);
  });

  it("normalizes a sponsor segment", () => {
    const raw: OpenAIProductResponse["sponsor_segments"] = [
      {
        sponsor_name: "BetterHelp",
        segment_start_context: "This episode is brought to you by BetterHelp",
        read_type: "host_read",
        estimated_read_through: 0.75,
        call_to_action: "betterhelp.com/mypod",
      },
    ];

    const result = normalizeSponsorSegments(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sponsor_name: "BetterHelp",
      read_type: "host_read",
      estimated_read_through: 0.75,
      call_to_action: "betterhelp.com/mypod",
    });
  });

  it("falls back to 'unknown' for invalid read_type", () => {
    const raw: OpenAIProductResponse["sponsor_segments"] = [
      {
        sponsor_name: "ACME Corp",
        segment_start_context: "brought to you by",
        read_type: "banner_ad",
        estimated_read_through: 0.5,
        call_to_action: null,
      },
    ];

    const result = normalizeSponsorSegments(raw);
    expect(result[0]?.read_type).toBe("unknown");
  });

  it("clamps estimated_read_through to 0.0-1.0", () => {
    const raw: OpenAIProductResponse["sponsor_segments"] = [
      {
        sponsor_name: "ACME",
        segment_start_context: "sponsored by",
        read_type: "mid_roll",
        estimated_read_through: 1.8,
        call_to_action: null,
      },
    ];

    const result = normalizeSponsorSegments(raw);
    expect(result[0]?.estimated_read_through).toBe(1.0);
  });

  it("filters out entries with empty sponsor_name", () => {
    const raw: OpenAIProductResponse["sponsor_segments"] = [
      {
        sponsor_name: "",
        segment_start_context: "sponsor segment",
        read_type: "host_read",
        estimated_read_through: 0.7,
        call_to_action: null,
      },
    ];

    expect(normalizeSponsorSegments(raw)).toHaveLength(0);
  });
});

// ============================================================================
// computeTrends
// ============================================================================

describe("computeTrends", () => {
  it("returns empty report for empty input", () => {
    const report = computeTrends([]);
    expect(report.trends).toHaveLength(0);
    expect(report.episode_ids).toHaveLength(0);
  });

  const makeExtraction = (
    episodeId: string,
    products: Array<{ name: string; category: string }>
  ): ExtractionResult => ({
    episode_id: episodeId,
    products: products.map((p) => ({
      name: p.name,
      category: p.category as import("../src/types.js").ProductCategory,
      mention_context: "context",
      speaker: null,
      confidence: 0.8,
      recommendation_strength: "moderate",
      affiliate_link: null,
      mention_count: 1,
    })),
    sponsor_segments: [],
    _meta: { processing_time_ms: 100, ai_cost_usd: 0.001, cache_hit: false },
  });

  it("identifies a rising trend when product appears in >60% of episodes", () => {
    const extractions: ExtractionResult[] = [
      makeExtraction("ep1", [{ name: "Notion", category: "saas" }]),
      makeExtraction("ep2", [{ name: "Notion", category: "saas" }]),
      makeExtraction("ep3", [{ name: "Notion", category: "saas" }]),
    ];

    const report = computeTrends(extractions);
    const notion = report.trends.find((t) => t.name === "Notion");
    expect(notion).toBeDefined();
    expect(notion?.trend).toBe("rising");
    expect(notion?.episodes_present).toBe(3);
  });

  it("identifies a falling trend when product appears in <30% of episodes", () => {
    const extractions: ExtractionResult[] = [
      makeExtraction("ep1", [{ name: "OldProduct", category: "physical_goods" }]),
      makeExtraction("ep2", []),
      makeExtraction("ep3", []),
      makeExtraction("ep4", []),
    ];

    const report = computeTrends(extractions);
    const old = report.trends.find((t) => t.name === "OldProduct");
    expect(old?.trend).toBe("falling");
  });

  it("aggregates mention counts across episodes", () => {
    const extractions: ExtractionResult[] = [
      makeExtraction("ep1", [
        { name: "Grammarly", category: "saas" },
        { name: "Grammarly", category: "saas" },
      ]),
      makeExtraction("ep2", [{ name: "Grammarly", category: "saas" }]),
    ];

    const report = computeTrends(extractions);
    const g = report.trends.find((t) => t.name === "Grammarly");
    expect(g?.total_mentions).toBeGreaterThan(0);
  });

  it("reports correct episode_ids", () => {
    const extractions: ExtractionResult[] = [
      makeExtraction("ep-alpha", [{ name: "X", category: "other" }]),
      makeExtraction("ep-beta", [{ name: "Y", category: "other" }]),
    ];

    const report = computeTrends(extractions);
    expect(report.episode_ids).toContain("ep-alpha");
    expect(report.episode_ids).toContain("ep-beta");
    expect(report.episode_ids).toHaveLength(2);
  });
});

// ============================================================================
// compareProductsAcrossShows
// ============================================================================

describe("compareProductsAcrossShows", () => {
  const makeExtraction = (
    episodeId: string,
    products: Array<{
      name: string;
      category?: string;
      confidence?: number;
      recommendation_strength?: string;
      speaker?: string | null;
    }>
  ): ExtractionResult => ({
    episode_id: episodeId,
    products: products.map((p) => ({
      name: p.name,
      category: (p.category ?? "physical_goods") as import("../src/types.js").ProductCategory,
      mention_context: `context for ${p.name}`,
      speaker: p.speaker ?? null,
      confidence: p.confidence ?? 0.9,
      recommendation_strength: (p.recommendation_strength ?? "strong") as import("../src/types.js").RecommendationStrength,
      affiliate_link: null,
      mention_count: 1,
    })),
    sponsor_segments: [],
    _meta: { processing_time_ms: 100, ai_cost_usd: 0.001, cache_hit: false },
  });

  it("returns empty products for empty extractions", () => {
    const report = compareProductsAcrossShows({ extractions: [] });
    expect(report.products).toHaveLength(0);
    expect(report.show_ids).toHaveLength(0);
  });

  it("filters out products below min_confidence", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Fiskars Hoe", confidence: 0.6 }]),
      makeExtraction("show-2", [{ name: "Fiskars Hoe", confidence: 0.6 }]),
    ];
    const report = compareProductsAcrossShows({ extractions, minConfidence: 0.85 });
    expect(report.products).toHaveLength(0);
  });

  it("filters by min_show_count — product in only 1 show excluded at default 2", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Corona Long Handle", confidence: 0.92 }]),
      makeExtraction("show-2", [{ name: "Unrelated Product", confidence: 0.95 }]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    expect(report.products).toHaveLength(0);
  });

  it("includes products appearing in required number of shows", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Fiskars Pruner", confidence: 0.91 }]),
      makeExtraction("show-2", [{ name: "Fiskars Pruner", confidence: 0.88 }]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    expect(report.products).toHaveLength(1);
    expect(report.products[0]?.product_name).toBe("Fiskars Pruner");
    expect(report.products[0]?.show_count).toBe(2);
  });

  it("min_show_count=1 includes single-show products", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Unique Tool", confidence: 0.9 }]),
    ];
    const report = compareProductsAcrossShows({ extractions, minShowCount: 1 });
    expect(report.products).toHaveLength(1);
    expect(report.products[0]?.show_count).toBe(1);
  });

  it("resolves same product name case-insensitively across shows", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Hori Hori Knife", confidence: 0.9 }]),
      makeExtraction("show-2", [{ name: "hori hori knife", confidence: 0.93 }]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    expect(report.products).toHaveLength(1);
    expect(report.products[0]?.show_count).toBe(2);
  });

  it("does NOT merge differently-named products from the same brand", () => {
    const extractions = [
      makeExtraction("show-1", [
        { name: "Fiskars Pruner", confidence: 0.9 },
        { name: "Fiskars Hoe", confidence: 0.9 },
      ]),
      makeExtraction("show-2", [
        { name: "Fiskars Pruner", confidence: 0.88 },
        { name: "Fiskars Hoe", confidence: 0.87 },
      ]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    // Both products appear in both shows — should be 2 separate entries
    expect(report.products).toHaveLength(2);
  });

  it("filters by category", () => {
    const extractions = [
      makeExtraction("show-1", [
        { name: "Fiskars Pruner", category: "physical_goods", confidence: 0.91 },
        { name: "Garden Planner App", category: "saas", confidence: 0.91 },
      ]),
      makeExtraction("show-2", [
        { name: "Fiskars Pruner", category: "physical_goods", confidence: 0.88 },
        { name: "Garden Planner App", category: "saas", confidence: 0.88 },
      ]),
    ];
    const report = compareProductsAcrossShows({ extractions, category: "physical_goods" });
    expect(report.products).toHaveLength(1);
    expect(report.products[0]?.category).toBe("physical_goods");
  });

  it("computes avg_confidence correctly", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Barebones Tool", confidence: 0.9 }]),
      makeExtraction("show-2", [{ name: "Barebones Tool", confidence: 0.8 }]),
    ];
    // minConfidence 0.75 so both shows pass the threshold; avg = (0.9 + 0.8) / 2 = 0.85
    const report = compareProductsAcrossShows({ extractions, minConfidence: 0.75 });
    expect(report.products[0]?.avg_confidence).toBeCloseTo(0.85, 2);
  });

  it("computes recommendation_consensus: unanimous when all shows recommend", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Dramm Wand", confidence: 0.9, recommendation_strength: "strong" }]),
      makeExtraction("show-2", [{ name: "Dramm Wand", confidence: 0.88, recommendation_strength: "moderate" }]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    expect(report.products[0]?.recommendation_consensus).toBe("unanimous");
  });

  it("computes recommendation_consensus: rare when no show recommends", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Meh Tool", confidence: 0.9, recommendation_strength: "mention" }]),
      makeExtraction("show-2", [{ name: "Meh Tool", confidence: 0.88, recommendation_strength: "mention" }]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    expect(report.products[0]?.recommendation_consensus).toBe("rare");
  });

  it("ranks by avg_confidence × show_count descending", () => {
    const extractions = [
      makeExtraction("show-1", [
        { name: "High Value Tool", confidence: 0.95 },
        { name: "Low Value Tool", confidence: 0.87 },
      ]),
      makeExtraction("show-2", [
        { name: "High Value Tool", confidence: 0.93 },
        { name: "Low Value Tool", confidence: 0.86 },
      ]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    expect(report.products[0]?.product_name).toBe("High Value Tool");
  });

  it("extracts brand from multi-word product name", () => {
    const extractions = [
      makeExtraction("show-1", [{ name: "Fiskars Snips", confidence: 0.92 }]),
      makeExtraction("show-2", [{ name: "Fiskars Snips", confidence: 0.9 }]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    expect(report.products[0]?.brand).toBe("Fiskars");
  });

  it("returns correct show_ids in report", () => {
    const extractions = [
      makeExtraction("garden-show-1", [{ name: "Hori Knife", confidence: 0.9 }]),
      makeExtraction("garden-show-2", [{ name: "Hori Knife", confidence: 0.91 }]),
    ];
    const report = compareProductsAcrossShows({ extractions });
    expect(report.show_ids).toContain("garden-show-1");
    expect(report.show_ids).toContain("garden-show-2");
  });
});

// ============================================================================
// extractProducts — mocked OpenAI call
// ============================================================================

describe("extractProducts (mocked OpenAI)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls OpenAI and returns normalized result", async () => {
    // Mock OpenAI at the module level using vi.mock
    vi.mock("openai", () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                products: [
                  {
                    name: "Headspace",
                    category: "saas",
                    mention_context: "I use Headspace every morning",
                    speaker: "Host",
                    confidence: 0.9,
                    recommendation_strength: "strong",
                    affiliate_link: null,
                  },
                ],
                sponsor_segments: [],
              }),
            },
          },
        ],
      });

      return {
        default: vi.fn().mockImplementation(() => ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        })),
      };
    });

    const { extractProducts: extract, setOpenAIClient } = await import("../src/extractor.js");

    // Create a mock OpenAI client
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    products: [
                      {
                        name: "Headspace",
                        category: "saas",
                        mention_context: "I use Headspace every morning",
                        speaker: "Host",
                        confidence: 0.9,
                        recommendation_strength: "strong",
                        affiliate_link: null,
                      },
                    ],
                    sponsor_segments: [],
                  }),
                },
              },
            ],
          }),
        },
      },
    };

    // Inject mock client
    setOpenAIClient(mockClient as unknown as import("openai").default);

    const result = await extract({
      transcript: "I use Headspace every morning for meditation.",
      episodeId: "test-ep-001",
    });

    expect(result.episode_id).toBe("test-ep-001");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.name).toBe("Headspace");
    expect(result.products[0]?.category).toBe("saas");
  });
});
