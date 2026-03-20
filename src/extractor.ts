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
  AestheticTags,
  CrossShowMention,
  CrossShowProduct,
  CrossShowBrand,
  CrossShowReport,
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

const VALID_WARMTH = new Set(["warm", "cool", "neutral"]);
const VALID_DENSITY = new Set(["minimal", "maximal", "balanced"]);
const VALID_ORIGIN = new Set(["natural", "synthetic", "mixed"]);
const VALID_TRADITION = new Set(["traditional", "contemporary", "hybrid"]);

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

For each product, also classify aesthetic character:
- aesthetic_warmth: "warm" (cozy, earthy, comfort-focused), "cool" (clean, clinical, tech-forward), or "neutral"
- aesthetic_density: "minimal" (simple, essential, pared back), "maximal" (rich, complex, indulgent), or "balanced"
- aesthetic_origin: "natural" (organic, artisan, plant-based), "synthetic" (engineered, tech, processed), or "mixed"
- aesthetic_tradition: "traditional" (heritage, classic, time-tested), "contemporary" (trending, innovative, modern), or "hybrid"

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
      const entry: ProductMention = {
        name,
        category,
        mention_context: (p.mention_context ?? "").slice(0, 100),
        speaker: p.speaker ?? null,
        confidence,
        recommendation_strength: strength,
        affiliate_link: p.affiliate_link ?? null,
        mention_count: 1,
      };

      const tags = parseAestheticTags(p);
      if (tags) entry.aestheticTags = tags;

      productMap.set(key, entry);
    }
  }

  return [...productMap.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Parse and validate aesthetic tag fields from a raw OpenAI product entry.
 * Returns undefined if no valid tags present.
 */
function parseAestheticTags(p: OpenAIProductResponse["products"][number]): AestheticTags | undefined {
  const warmth = VALID_WARMTH.has(p.aesthetic_warmth ?? "") ? p.aesthetic_warmth as AestheticTags["warmth"] : null;
  const density = VALID_DENSITY.has(p.aesthetic_density ?? "") ? p.aesthetic_density as AestheticTags["density"] : null;
  const origin = VALID_ORIGIN.has(p.aesthetic_origin ?? "") ? p.aesthetic_origin as AestheticTags["origin"] : null;
  const tradition = VALID_TRADITION.has(p.aesthetic_tradition ?? "") ? p.aesthetic_tradition as AestheticTags["tradition"] : null;

  if (!warmth && !density && !origin && !tradition) return undefined;

  return {
    warmth: warmth ?? "neutral",
    density: density ?? "balanced",
    origin: origin ?? "mixed",
    tradition: tradition ?? "hybrid",
  };
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
// RETRY HELPERS
// ============================================================================

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns true for transient OpenAI errors that are worth retrying:
 * rate limits (429), server errors (5xx), and network-level connection errors.
 * Does NOT retry on 4xx client errors (bad request, auth, etc.).
 * Does NOT retry on LLM call timeouts — if the API is slow enough to hit the
 * 15s threshold, a retry will also timeout, doubling worst-case latency
 * (~20s → ~46s) with no improvement in success rate (observed 2026-03-19).
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    return err.status === 429 || err.status >= 500;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Only retry network-level transient connection errors, not read timeouts
    return msg.includes("etimedout") || msg.includes("econnreset");
  }
  return false;
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
    // Sanitize category names to prevent prompt injection (OWASP MCP audit 2026-03-10)
    const safeCategories = categoryFilter
      .map((c) => c.replace(/[^\w\s\-\/]/g, "").trim())
      .filter(Boolean);
    if (safeCategories.length > 0) {
      userMessage += `\n\nOnly include products in these categories: ${safeCategories.join(", ")}`;
    }
  }

  let response: OpenAI.Chat.Completions.ChatCompletion | undefined;
  let extractionError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 2000,
        stream: false,
      });
      extractionError = undefined;
      break;
    } catch (err) {
      extractionError = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        await sleep(RETRY_DELAY_MS);
      } else {
        break;
      }
    }
  }
  if (!response) {
    // Re-throw so the worker's try-catch can surface via errorResult()
    throw extractionError;
  }

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

  const cta_rate =
    sponsor_count > 0
      ? sponsors.filter(s => s.call_to_action !== null).length / sponsor_count
      : 0;

  return {
    sponsors,
    sponsor_count,
    avg_read_through: Math.round(avg_read_through * 100) / 100,
    cta_rate: Math.round(cta_rate * 100) / 100,
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

  // Aggregate: product name → { episodes_present, total_mentions, total_strength, category }
  const productMap = new Map<
    string,
    { episodes_present: number; total_mentions: number; total_strength: number; category: ProductCategory }
  >();

  for (const extraction of extractions) {
    // Deduplicate within this episode to count episodes_present correctly
    const seenInEpisode = new Set<string>();

    for (const product of extraction.products) {
      const key = product.name.toLowerCase();
      const strengthScore = STRENGTH_RANK[product.recommendation_strength] ?? 1;

      if (!seenInEpisode.has(key)) {
        seenInEpisode.add(key);
        const existing = productMap.get(key);
        if (existing) {
          existing.episodes_present += 1;
          existing.total_mentions += product.mention_count;
          existing.total_strength += strengthScore;
        } else {
          productMap.set(key, {
            episodes_present: 1,
            total_mentions: product.mention_count,
            total_strength: strengthScore,
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
      brand: extractBrand(originalName),
      category: data.category,
      trend,
      episodes_present: data.episodes_present,
      total_mentions: data.total_mentions,
      avg_recommendation_strength:
        data.episodes_present > 0
          ? Math.round((data.total_strength / data.episodes_present) * 100) / 100
          : 0,
    });
  }

  // Sort: rising first, then by episodes_present desc
  trends.sort((a, b) => {
    const trendOrder = { rising: 0, stable: 1, falling: 2 };
    const orderDiff = trendOrder[a.trend] - trendOrder[b.trend];
    if (orderDiff !== 0) return orderDiff;
    return b.episodes_present - a.episodes_present;
  });

  // top_category: category with the most trending products — routing signal
  const categoryCount = new Map<ProductCategory, number>();
  for (const t of trends) {
    categoryCount.set(t.category, (categoryCount.get(t.category) ?? 0) + 1);
  }
  const topEntry = [...categoryCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const top_category = topEntry ? topEntry[0] : undefined;

  return {
    trends,
    episode_ids,
    ...(top_category !== undefined ? { top_category } : {}),
  };
}

// ============================================================================
// CROSS-SHOW PRODUCT COMPARISON
// ============================================================================

export interface CompareProductsAcrossShowsParams {
  extractions: ExtractionResult[];
  category?: string | null;
  minConfidence?: number;   // default 0.85
  minShowCount?: number;    // default 2
}

/**
 * Normalize a product name for entity resolution.
 * Lowercase, trim, collapse whitespace, strip non-word characters.
 */
function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Extract brand from a product name using a simple first-word heuristic.
 * For single-word names, returns the name itself if it looks like a proper noun
 * or acronym (starts with uppercase), so that brands like "AG1", "Oura", "Viome"
 * surface correctly in cross-show brand rollups. Returns null for lowercase
 * single-word generics like "supplement".
 */
function extractBrand(productName: string): string | null {
  const words = productName.trim().split(/\s+/);
  if (words.length === 0) return null;
  if (words.length === 1) {
    const word = words[0] ?? "";
    return /^[A-Z]/.test(word) ? word : null;
  }
  return words[0] ?? null;
}

/**
 * Compute recommendation consensus across a set of per-show mentions.
 * "unanimous" — every show recommends (strong/moderate)
 * "majority"  — >50% recommend
 * "mixed"     — some recommend, some don't
 * "rare"      — no show recommends
 */
function computeConsensus(shows: CrossShowMention[]): CrossShowProduct["recommendation_consensus"] {
  const total = shows.length;
  if (total === 0) return "rare";
  const recommends = shows.filter(
    (s) => s.recommendation_strength === "strong" || s.recommendation_strength === "moderate",
  ).length;
  if (recommends === total) return "unanimous";
  if (recommends > total / 2) return "majority";
  if (recommends > 0) return "mixed";
  return "rare";
}

/**
 * Compare product mentions across multiple shows using cached extractions.
 * Pure local computation — no OpenAI calls.
 * Entity resolution: normalized name equality (case-insensitive, punctuation-stripped).
 * Ranking: avg_confidence × show_count descending.
 */
export function compareProductsAcrossShows(
  params: CompareProductsAcrossShowsParams,
): CrossShowReport {
  const {
    extractions,
    category,
    minConfidence = 0.85,
    minShowCount = 2,
  } = params;

  const show_ids = extractions.map((e) => e.episode_id);

  // Map: normalized name → accumulated data
  const productMap = new Map<
    string,
    {
      originalName: string;
      category: ProductCategory;
      mentions: Array<{ showId: string; product: ProductMention }>;
    }
  >();

  for (const extraction of extractions) {
    const showId = extraction.episode_id;
    for (const product of extraction.products) {
      if (product.confidence < minConfidence) continue;
      if (category && product.category !== category) continue;

      const key = normalizeProductName(product.name);
      if (!key) continue;

      const existing = productMap.get(key);
      if (existing) {
        // One mention per show — keep the highest-confidence one
        const showIdx = existing.mentions.findIndex((m) => m.showId === showId);
        if (showIdx === -1) {
          existing.mentions.push({ showId, product });
        } else if (product.confidence > (existing.mentions[showIdx]?.product.confidence ?? 0)) {
          existing.mentions[showIdx] = { showId, product };
        }
      } else {
        productMap.set(key, {
          originalName: product.name,
          category: product.category,
          mentions: [{ showId, product }],
        });
      }
    }
  }

  const products: CrossShowProduct[] = [];

  for (const [, data] of productMap.entries()) {
    if (data.mentions.length < minShowCount) continue;

    const shows: CrossShowMention[] = data.mentions.map(({ showId, product }) => ({
      show_id: showId,
      episode_id: showId,
      mention_context: product.mention_context,
      host: product.speaker,
      confidence: product.confidence,
      recommendation_strength: product.recommendation_strength,
    }));

    const avg_confidence =
      shows.reduce((sum, s) => sum + s.confidence, 0) / shows.length;

    products.push({
      product_name: data.originalName,
      brand: extractBrand(data.originalName),
      category: data.category,
      shows,
      show_count: shows.length,
      avg_confidence: Math.round(avg_confidence * 1000) / 1000,
      recommendation_consensus: computeConsensus(shows),
    });
  }

  // Rank by avg_confidence × show_count descending
  products.sort((a, b) => b.avg_confidence * b.show_count - a.avg_confidence * a.show_count);

  // Brand-level rollup: aggregate all confidence-passing products by brand across shows.
  // Surfaces brand presence (e.g. "Espoma in 2 shows, 3 products") even when individual
  // product names don't match across shows.
  const brandMap = new Map<
    string,
    { shows: Set<string>; products: string[]; confidences: number[] }
  >();

  for (const extraction of extractions) {
    const showId = extraction.episode_id;
    for (const product of extraction.products) {
      if (product.confidence < minConfidence) continue;
      if (category && product.category !== category) continue;
      const brand = extractBrand(product.name);
      if (!brand) continue;
      const existing = brandMap.get(brand);
      if (existing) {
        existing.shows.add(showId);
        if (!existing.products.includes(product.name)) existing.products.push(product.name);
        existing.confidences.push(product.confidence);
      } else {
        brandMap.set(brand, {
          shows: new Set([showId]),
          products: [product.name],
          confidences: [product.confidence],
        });
      }
    }
  }

  const brands: CrossShowBrand[] = [];
  for (const [brand, data] of brandMap.entries()) {
    if (data.shows.size < 2) continue; // Only multi-show brands
    const avg_conf = data.confidences.reduce((s, c) => s + c, 0) / data.confidences.length;
    brands.push({
      brand,
      product_count: data.products.length,
      show_count: data.shows.size,
      shows: Array.from(data.shows),
      avg_confidence: Math.round(avg_conf * 1000) / 1000,
      products: data.products,
    });
  }
  brands.sort((a, b) => b.show_count * b.product_count - a.show_count * a.product_count);

  return { products, brands, show_ids };
}
