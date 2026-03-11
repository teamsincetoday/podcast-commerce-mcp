/**
 * Podcast Commerce MCP — Eval Framework Types
 *
 * Quality evaluation for extraction accuracy on real-world podcast transcripts.
 * Three modes:
 *   fixture  — mocked extractor, tests scoring logic and schema correctness
 *   live     — real OpenAI calls, validates extraction quality on real content
 *   snapshot — update golden snapshots from live output
 */

import type { ProductMention } from "../src/types.js";

// ============================================================================
// EVAL CASE
// ============================================================================

export interface ExpectedProduct {
  /** Exact or partial product name match (case-insensitive) */
  name: string;
  /** Expected category */
  category: string;
  /** Must be present in output — failure if missing */
  required: boolean;
}

export interface PodcastEvalCase {
  id: string;
  name: string;
  /** Data provenance — where the transcript was sourced from */
  source: string;
  /** Full transcript text (real content from source) */
  transcript: string;
  /** Products we expect extraction to identify */
  expectedProducts: ExpectedProduct[];
  /** Max token budget for JSON output (default: 2000) */
  maxTokens?: number;
}

// ============================================================================
// EVAL RESULT
// ============================================================================

export interface ScorerResult {
  dimension: string;
  score: number;   // 0-100
  target: number;  // pass threshold
  details: string;
  passed: boolean;
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  timestamp: string;
  scores: ScorerResult[];
  overallScore: number;
  passed: boolean;
  productsExtracted: ProductMention[];
}
