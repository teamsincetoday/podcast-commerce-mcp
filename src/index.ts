/**
 * Podcast Commerce Intelligence MCP — Public API
 *
 * Export the server factory and key types for programmatic use.
 */

export { createServer, startStdioServer } from "./server.js";
export { getCache, PodcastCache, FREE_TIER_DAILY_LIMIT } from "./cache.js";
export {
  extractProducts,
  buildSponsorAnalysis,
  computeTrends,
  resolveTranscript,
  normalizeProducts,
  normalizeSponsorSegments,
  setOpenAIClient,
} from "./extractor.js";

export type {
  ProductMention,
  SponsorSegment,
  ExtractionResult,
  ExtractionMeta,
  SponsorAnalysis,
  TrendReport,
  ProductTrend,
  ProductCategory,
  RecommendationStrength,
  AuthResult,
  PaymentMethod,
} from "./types.js";
