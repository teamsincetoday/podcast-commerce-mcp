/**
 * Podcast Commerce MCP — Eval Framework Types
 *
 * Adapted from video-commerce-mcp eval framework.
 * Evaluates extractProducts() output against ground truth.
 */

import type { ExtractionResult } from "../../types.js";

export interface PodcastEvalCase {
  id: string;
  name: string;
  description: string;
  /** Raw transcript text (not a URL — deterministic, network-free) */
  transcript: string;
  episodeId: string;
  /** Expected products — ground truth for recall/precision scoring */
  expectedProducts: ExpectedProduct[];
  /** Expected sponsor segments */
  expectedSponsors: ExpectedSponsor[];
  /** Maximum cost in USD */
  maxCostUsd?: number;
}

export interface ExpectedProduct {
  name: string;
  category?: string;
  required: boolean;
  /** Minimum recommendation_strength we expect */
  minStrength?: "strong" | "moderate" | "mention";
}

export interface ExpectedSponsor {
  name: string;
  required: boolean;
}

export interface ScorerResult {
  dimension: string;
  score: number;       // 0-100
  target: number;      // target score 0-100
  weight: number;      // business weight 0-1
  details: string;
  passed: boolean;
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  timestamp: string;
  mode: "fixture" | "live";
  scores: ScorerResult[];
  overallScore: number;
  passed: boolean;
  durationMs: number;
  /** Captured metrics for value narrative fill-in */
  metrics?: EvalMetrics;
  error?: string;
}

export interface EvalMetrics {
  entity_count: number;
  sponsor_count: number;
  avg_confidence: number;
  latency_ms: number;
  cost_usd: number;
  /** Products with non-null affiliate_link */
  affiliate_matches: number;
  /** Precision/recall/F1 vs ground truth */
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalReport {
  timestamp: string;
  mode: "fixture" | "live";
  results: EvalResult[];
  summary: {
    totalCases: number;
    passed: number;
    failed: number;
    overallScore: number;
    dimensionAverages: Record<string, number>;
  };
  /** Aggregated metrics across all cases (for value narrative fill-in) */
  aggregatedMetrics: {
    avg_entity_count: number;
    avg_latency_ms: number;
    avg_cost_usd: number;
    avg_f1: number;
    avg_confidence: number;
    total_affiliate_matches: number;
  };
  priorities: ImprovementPriority[];
}

export interface ImprovementPriority {
  dimension: string;
  gap: number;
  weightedGap: number;
  suggestion: string;
}

export type { ExtractionResult };
