/**
 * Podcast Commerce Intelligence MCP — Core Types
 *
 * Single source of truth for all types shared across cache, extractor, and server.
 */

// ============================================================================
// ENUMS / UNION TYPES
// ============================================================================

export type ProductCategory =
  | "physical_goods"
  | "saas"
  | "course"
  | "service"
  | "supplement"
  | "media"
  | "event"
  | "other";

export type RecommendationStrength = "strong" | "moderate" | "mention" | "negative";

export interface AestheticTags {
  warmth: "warm" | "cool" | "neutral";
  density: "minimal" | "maximal" | "balanced";
  origin: "natural" | "synthetic" | "mixed";
  tradition: "traditional" | "contemporary" | "hybrid";
}

export type SponsorReadType =
  | "host_read"
  | "mid_roll"
  | "pre_roll"
  | "post_roll"
  | "unknown";

export type PaymentMethod = "disabled" | "api_key" | "free_tier";

// ============================================================================
// CORE ENTITIES
// ============================================================================

export interface ProductMention {
  name: string;
  category: ProductCategory;
  mention_context: string;
  speaker: string | null;
  confidence: number;
  recommendation_strength: RecommendationStrength;
  affiliate_link: string | null;
  mention_count: number;
  aestheticTags?: AestheticTags;
}

export interface SponsorSegment {
  sponsor_name: string;
  segment_start_context: string;
  read_type: SponsorReadType;
  estimated_read_through: number;
  call_to_action: string | null;
}

// ============================================================================
// EXTRACTION RESULTS
// ============================================================================

export interface ExtractionMeta {
  processing_time_ms: number;
  ai_cost_usd: number;
  cache_hit: boolean;
  [key: string]: unknown;
}

export interface ExtractionResult {
  episode_id: string;
  products: ProductMention[];
  sponsor_segments: SponsorSegment[];
  _meta: ExtractionMeta;
}

// ============================================================================
// SPONSOR ANALYSIS
// ============================================================================

export interface SponsorAnalysis {
  sponsors: SponsorSegment[];
  /** Total number of sponsor segments identified in the episode. */
  sponsor_count: number;
  avg_read_through: number;
  /** Fraction of sponsor segments that include a trackable CTA (promo code, URL). 0 = no CTAs, 1 = all sponsors have CTAs. Gate: cta_rate > 0 means CTA extraction is worth running. */
  cta_rate: number;
  _meta: Record<string, unknown>;
}

// ============================================================================
// TREND REPORT
// ============================================================================

export interface ProductTrend {
  name: string;
  category: ProductCategory;
  trend: "rising" | "stable" | "falling";
  episodes_present: number;
  total_mentions: number;
  /** Average recommendation strength score (0–3: strong=3, moderate=2, mention=1, negative=0) */
  avg_recommendation_strength: number;
}

export interface TrendReport {
  trends: ProductTrend[];
  episode_ids: string[];
  /** Category with the highest number of trending products — routing signal for downstream affiliate decisions. */
  top_category?: ProductCategory;
  _meta?: Record<string, unknown>;
}

// ============================================================================
// OPENAI RAW RESPONSE SHAPES
// ============================================================================

export interface OpenAIProductResponse {
  products: Array<{
    name: string;
    category: string;
    mention_context: string;
    speaker: string | null;
    confidence: number;
    recommendation_strength: string;
    affiliate_link: string | null;
    aesthetic_warmth?: string;
    aesthetic_density?: string;
    aesthetic_origin?: string;
    aesthetic_tradition?: string;
  }>;
  sponsor_segments: Array<{
    sponsor_name: string;
    segment_start_context: string;
    read_type: string;
    estimated_read_through: number;
    call_to_action: string | null;
  }>;
}

// ============================================================================
// CROSS-SHOW COMPARISON
// ============================================================================

export interface CrossShowMention {
  show_id: string;
  episode_id: string;
  mention_context: string;
  host: string | null;
  confidence: number;
  recommendation_strength: RecommendationStrength;
}

export interface CrossShowProduct {
  product_name: string;
  brand: string | null;
  category: ProductCategory;
  shows: CrossShowMention[];
  show_count: number;
  avg_confidence: number;
  recommendation_consensus: "unanimous" | "majority" | "mixed" | "rare";
}

/** Brand-level rollup: groups all products from the same brand across shows. */
export interface CrossShowBrand {
  brand: string;
  product_count: number;
  show_count: number;
  shows: string[];
  avg_confidence: number;
  products: string[];
}

export interface CrossShowReport {
  products: CrossShowProduct[];
  brands: CrossShowBrand[];
  show_ids: string[];
  _meta?: Record<string, unknown>;
}

// ============================================================================
// AUTH
// ============================================================================

export interface AuthResult {
  authorized: boolean;
  method?: PaymentMethod;
  reason?: string;
}
