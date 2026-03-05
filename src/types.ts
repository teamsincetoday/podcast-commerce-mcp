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
  sponsor_count: number;
  avg_read_through: number;
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
}

export interface TrendReport {
  trends: ProductTrend[];
  episode_ids: string[];
  analysis_window_episodes: number;
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
// AUTH
// ============================================================================

export interface AuthResult {
  authorized: boolean;
  method?: PaymentMethod;
  reason?: string;
}
