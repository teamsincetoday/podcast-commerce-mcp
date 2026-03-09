/**
 * Podcast Product Mention Extractor — OpenAI-based
 *
 * Uses GPT-4o-mini to extract product mentions and sponsor segments from
 * podcast transcripts. No runtime pattern-matching — structured LLM output.
 *
 * Exported API:
 *   setOpenAIClient()       — inject client for testing
 *   resolveTranscript()     — fetch YouTube transcript or pass raw text
 *   extractProducts()       — main async extraction (episode_id, products, sponsor_segments)
 *   normalizeProducts()     — normalize raw OpenAI product list
 *   normalizeSponsorSegments() — normalize raw OpenAI sponsor list
 *   buildSponsorAnalysis()  — derive SponsorAnalysis from ExtractionResult
 *   computeTrends()         — compute rising/stable/falling trends across episodes
 */

import OpenAI from "openai";
import type {
  ProductMention,
  ProductCategory,
  RecommendationStrength,
  SponsorSegment,
  SponsorReadType,
  ExtractionResult,
  OpenAIProductResponse,
  SponsorAnalysis,
  TrendReport,
  ProductTrend,
} from "./types.js";
import { fetchTranscript } from "./transcript-fetcher.js";

// ============================================================================
// CLIENT INJECTION
// ============================================================================

let _openAIClient: OpenAI | null = null;

/**
 * Inject a custom OpenAI client. Useful for testing (mock injection).
 */
export function setOpenAIClient(client: OpenAI): void {
  _openAIClient = client;
}

function getOpenAIClient(): OpenAI {
  if (_openAIClient) return _openAIClient;
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
      "Set it to use the extraction tools."
    );
  }
  _openAIClient = new OpenAI({ apiKey });
  return _openAIClient;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const OPENAI_MODEL = "gpt-4o-mini";
const INPUT_COST_PER_1K = 0.000_150;   // $0.15 / 1M tokens
const OUTPUT_COST_PER_1K = 0.000_600;  // $0.60 / 1M tokens

const VALID_CATEGORIES = new Set<ProductCategory>([
  "physical_goods", "saas", "course", "service",
  "supplement", "media", "event", "other",
]);

const VALID_STRENGTHS = new Set<RecommendationStrength>([
  "strong", "moderate", "mention", "negative",
]);

const VALID_READ_TYPES = new Set<SponsorReadType>([
  "host_read", "mid_roll", "pre_roll", "post_roll",
]);

const STRENGTH_RANK: Record<RecommendationStrength, number> = {
  strong: 3, moderate: 2, mention: 1, negative: 0,
};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are a product and brand intelligence extractor specialized in podcast transcripts.

Extract all product, brand, and service mentions from the provided podcast transcript.

For each product/brand mention:
- name: Exact product or brand name (string)
- category: One of exactly: physical_goods, saas, course, service, supplement, media, event, other
- mention_context: Exact sentence or phrase containing the mention (max 100 chars)
- speaker: Detected speaker ("host", "guest", or name from transcript), or null if unknown
- confidence: 0.0-1.0 — how confident this is a genuine product/brand mention
- recommendation_strength: "strong" (must-have/highly recommend), "moderate" (I use/recommend), "mention" (neutral reference), "negative" (warning/avoid)
- affiliate_link: Any affiliate or referral URL found in context, or null

Also identify sponsor segments:
- sponsor_name: Sponsor's brand name
- segment_start_context: Opening phrase of the sponsor read (max 50 chars)
- read_type: "host_read", "mid_roll", "pre_roll", "post_roll", or "unknown"
- estimated_read_through: 0.0-1.0 (0=skippable, 1=very compelling)
- call_to_action: URL, promo code, or CTA text, or null

Rules:
- Only include products with confidence >= 0.4
- Deduplicate the same product (merge repeated mentions, use highest confidence)
- Focus on things listeners might actually buy or use

Return ONLY valid JSON (no markdown, no explanation):
{"products":[...],"sponsor_segments":[...]}`;

// ============================================================================
// NORMALIZE HELPERS
// ============================================================================

/**
 * Normalize raw OpenAI product array into typed ProductMention[].
 * Deduplicates by name (case-insensitive), clamps confidence, falls back
 * to "other" / "mention" for invalid enum values.
 */
export function normalizeProducts(
  raw: OpenAIProductResponse["products"],
): ProductMention[] {
  const productMap = new Map<string, ProductMention>();

  for (const p of raw) {
    const name = (p.name ?? "").trim();
    if (!name) continue;

    const key = name.toLowerCase();

    const category: ProductCategory = VALID_CATEGORIES.has(p.category as ProductCategory)
      ? (p.category as ProductCategory)
      : "other";

    const strength: RecommendationStrength = VALID_STRENGTHS.has(
      p.recommendation_strength as RecommendationStrength
    )
      ? (p.recommendation_strength as RecommendationStrength)
      : "mention";

    const confidence = Math.min(Math.max(Number(p.confidence) || 0, 0), 1);

    const existing = productMap.get(key);
    if (existing) {
      // Merge: keep highest confidence, best strength, first affiliate link
      existing.mention_count += 1;
      if (confidence > existing.confidence) {
        existing.confidence = confidence;
      }
      if (STRENGTH_RANK[strength] > STRENGTH_RANK[existing.recommendation_strength]) {
        existing.recommendation_strength = strength;
      }
      if (!existing.affiliate_link && p.affiliate_link) {
        existing.affiliate_link = p.affiliate_link;
      }
    } else {
      productMap.set(key, {
        name,
        category,
        mention_context: (p.mention_context ?? "").slice(0, 100),
        speaker: p.speaker ?? null,
        confidence,
        recommendation_strength: strength,
        affiliate_link: p.affiliate_link ?? null,
        mention_count: 1,
      });
    }
  }

  return [...productMap.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Normalize raw OpenAI sponsor segment array into typed SponsorSegment[].
 * Filters empty names, clamps read-through, falls back to "unknown" for
 * invalid read_type values.
 */
export function normalizeSponsorSegments(
  raw: OpenAIProductResponse["sponsor_segments"],
): SponsorSegment[] {
  return raw
    .filter(s => (s.sponsor_name ?? "").trim() !== "")
    .map(s => {
      const readType: SponsorReadType = VALID_READ_TYPES.has(s.read_type as SponsorReadType)
        ? (s.read_type as SponsorReadType)
        : "unknown";

      return {
        sponsor_name: s.sponsor_name.trim(),
        segment_start_context: (s.segment_start_context ?? "").slice(0, 50),
        read_type: readType,
        estimated_read_through: Math.min(
          Math.max(Number(s.estimated_read_through) || 0, 0),
          1,
        ),
        call_to_action: s.call_to_action ?? null,
      };
    });
}

// ============================================================================
// TRANSCRIPT RESOLVER
// ============================================================================

/**
 * Resolve a transcript input to plain text.
 * If the input is a YouTube URL, fetches the transcript.
 * Otherwise, returns the input as-is (raw text).
 */
export async function resolveTranscript(input: string): Promise<string> {
  const trimmed = input.trim();

  // Check for YouTube URL
  const youtubePattern =
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;

  if (youtubePattern.test(trimmed)) {
    const parsed = await fetchTranscript(trimmed, "url");
    return parsed.text;
  }

  // Raw transcript text
  return trimmed;
}

// ============================================================================
// MAIN EXTRACTION
// ============================================================================

export interface ExtractProductsParams {
  transcript: string;          // raw text or YouTube URL
  episodeId: string;
  categoryFilter?: string[] | null;
}

export interface RawExtractionResult {
  episode_id: string;
  products: ProductMention[];
  sponsor_segments: SponsorSegment[];
  ai_cost_usd: number;
}

/**
 * Extract products and sponsor segments from a podcast transcript using OpenAI.
 * Returns a raw result (no _meta) — server.ts adds _meta after timing.
 */
export async function extractProducts(
  params: ExtractProductsParams,
): Promise<RawExtractionResult> {
  const { transcript, episodeId, categoryFilter } = params;

  // Resolve to plain text (handles YouTube URLs)
  const text = await resolveTranscript(transcript);

  const client = getOpenAIClient();

  // Build user message — optionally mention category filter
  let userMessage = `Extract products and sponsor segments from this podcast transcript:\n\n${text}`;
  if (categoryFilter && categoryFilter.length > 0) {
    userMessage += `\n\nOnly include products in these categories: ${categoryFilter.join(", ")}`;
  }

  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  // Parse response
  const rawContent = response.choices[0]?.message?.content ?? "{}";
  let parsed: OpenAIProductResponse;

  try {
    parsed = JSON.parse(rawContent) as OpenAIProductResponse;
  } catch {
    parsed = { products: [], sponsor_segments: [] };
  }

  // Ensure arrays exist
  const rawProducts = Array.isArray(parsed.products) ? parsed.products : [];
  const rawSponsors = Array.isArray(parsed.sponsor_segments)
    ? parsed.sponsor_segments
    : [];

  // Normalize
  let products = normalizeProducts(rawProducts);
  const sponsor_segments = normalizeSponsorSegments(rawSponsors);

  // Apply category filter after normalization if provided
  if (categoryFilter && categoryFilter.length > 0) {
    const filterSet = new Set(categoryFilter);
    products = products.filter(p => filterSet.has(p.category));
  }

  // Estimate cost from token usage
  const usage = response.usage;
  const ai_cost_usd = usage
    ? (usage.prompt_tokens / 1000) * INPUT_COST_PER_1K +
      (usage.completion_tokens / 1000) * OUTPUT_COST_PER_1K
    : 0;

  return {
    episode_id: episodeId,
    products,
    sponsor_segments,
    ai_cost_usd,
  };
}

// ============================================================================
// SPONSOR ANALYSIS
// ============================================================================

/**
 * Build a sponsor analysis report from an existing extraction result.
 * No additional API calls — purely local computation.
 */
export function buildSponsorAnalysis(extraction: ExtractionResult): SponsorAnalysis {
  const sponsors = extraction.sponsor_segments;
  const sponsor_count = sponsors.length;

  const avg_read_through =
    sponsor_count > 0
      ? sponsors.reduce((sum, s) => sum + s.estimated_read_through, 0) /
        sponsor_count
      : 0;

  return {
    sponsors,
    avg_read_through: Math.round(avg_read_through * 100) / 100,
    _meta: {},
  };
}

// ============================================================================
// TREND ANALYSIS
// ============================================================================

/**
 * Compute rising / stable / falling product trends across multiple episodes.
 *
 * Classification thresholds:
 *   - rising:  present in >60% of episodes
 *   - falling: present in <30% of episodes
 *   - stable:  30%–60%
 */
export function computeTrends(extractions: ExtractionResult[]): TrendReport {
  const episode_ids = extractions.map(e => e.episode_id);
  const totalEpisodes = extractions.length;

  if (totalEpisodes === 0) {
    return { trends: [], episode_ids: [] };
  }

  // Aggregate: product name → { episodes_present, total_mentions, category }
  const productMap = new Map<
    string,
    { episodes_present: number; total_mentions: number; category: ProductCategory }
  >();

  for (const extraction of extractions) {
    // Deduplicate within this episode to count episodes_present correctly
    const seenInEpisode = new Set<string>();

    for (const product of extraction.products) {
      const key = product.name.toLowerCase();

      if (!seenInEpisode.has(key)) {
        seenInEpisode.add(key);
        const existing = productMap.get(key);
        if (existing) {
          existing.episodes_present += 1;
          existing.total_mentions += product.mention_count;
        } else {
          productMap.set(key, {
            episodes_present: 1,
            total_mentions: product.mention_count,
            category: product.category,
          });
        }
      } else {
        // Same product appearing multiple times in the same extraction list —
        // add to total_mentions but don't increment episodes_present again
        const existing = productMap.get(key);
        if (existing) {
          existing.total_mentions += product.mention_count;
        }
      }
    }
  }

  const trends: ProductTrend[] = [];

  for (const [name, data] of productMap.entries()) {
    const presenceRate = data.episodes_present / totalEpisodes;
    let trend: ProductTrend["trend"];

    if (presenceRate > 0.6) {
      trend = "rising";
    } else if (presenceRate < 0.3) {
      trend = "falling";
    } else {
      trend = "stable";
    }

    // Capitalize product name (use original casing from first occurrence)
    const originalName =
      extractions
        .flatMap(e => e.products)
        .find(p => p.name.toLowerCase() === name)?.name ?? name;

    trends.push({
      name: originalName,
      category: data.category,
      trend,
      episodes_present: data.episodes_present,
      total_mentions: data.total_mentions,
    });
  }

  // Sort: rising first, then by episodes_present desc
  trends.sort((a, b) => {
    const trendOrder = { rising: 0, stable: 1, falling: 2 };
    const orderDiff = trendOrder[a.trend] - trendOrder[b.trend];
    if (orderDiff !== 0) return orderDiff;
    return b.episodes_present - a.episodes_present;
  });

  return {
    trends,
    episode_ids,
  };
}
