/**
 * Podcast Commerce MCP — Eval Scorers
 *
 * Four scoring dimensions:
 *   entity_recall  — did extraction find the expected products? (recall + required-only gate)
 *   value          — is output actionable? (entity count, categories, confidence scores present)
 *   accuracy       — precision/recall/F1 against ground truth expected products
 *   cost           — was token count within budget?
 */

import type { ScorerResult, PodcastEvalCase } from "./eval-types.js";
import type { ExtractionResult } from "../src/types.js";

// ---------------------------------------------------------------------------
// Entity recall scorer
// ---------------------------------------------------------------------------

export function scoreEntityRecall(
  evalCase: PodcastEvalCase,
  result: ExtractionResult
): ScorerResult {
  const expected = evalCase.expectedProducts;
  const actual = result.products ?? [];

  if (expected.length === 0) {
    return {
      dimension: "entity_recall",
      score: 100,
      target: 80,
      details: "No products expected — skipped",
      passed: true,
    };
  }

  const required = expected.filter((e) => e.required);
  let foundRequired = 0;
  let foundTotal = 0;

  for (const exp of expected) {
    const hit = actual.some((a) =>
      a.name.toLowerCase().includes(exp.name.toLowerCase()) ||
      exp.name.toLowerCase().includes(a.name.toLowerCase())
    );
    if (hit) {
      foundTotal++;
      if (exp.required) foundRequired++;
    }
  }

  const requiredRecall = required.length > 0 ? (foundRequired / required.length) * 100 : 100;
  const overallRecall = (foundTotal / expected.length) * 100;
  const score = Math.round(requiredRecall * 0.7 + overallRecall * 0.3);

  return {
    dimension: "entity_recall",
    score,
    target: 80,
    details: `${foundTotal}/${expected.length} found (${foundRequired}/${required.length} required). Actual total: ${actual.length}`,
    passed: score >= 80,
  };
}

// ---------------------------------------------------------------------------
// Value scorer — is output actionable?
// ---------------------------------------------------------------------------

export function scoreValue(
  evalCase: PodcastEvalCase,
  result: ExtractionResult
): ScorerResult {
  const products = result.products ?? [];
  let score = 0;
  const reasons: string[] = [];

  // Has products (40pts)
  if (products.length > 0) {
    score += 40;
    reasons.push(`${products.length} products extracted`);
  }

  // Has confidence scores (20pts)
  const hasConfidence = products.some((p) => p.confidence !== undefined && p.confidence > 0);
  if (hasConfidence) { score += 20; reasons.push("confidence scores present"); }

  // Has recommendation_strength (20pts)
  const hasStrength = products.some((p) => "recommendation_strength" in p);
  if (hasStrength) { score += 20; reasons.push("recommendation_strength present"); }

  // Has categories (20pts)
  const hasCats = products.some((p) => p.category && p.category.length > 0);
  if (hasCats) { score += 20; reasons.push("categories classified"); }

  return {
    dimension: "value",
    score,
    target: 70,
    details: reasons.join(", ") || "No products found",
    passed: score >= 70,
  };
}

// ---------------------------------------------------------------------------
// Accuracy scorer — F1 against ground truth
// ---------------------------------------------------------------------------

export function scoreAccuracy(
  evalCase: PodcastEvalCase,
  result: ExtractionResult
): ScorerResult {
  const expected = evalCase.expectedProducts;
  const actual = result.products ?? [];

  if (expected.length === 0 && actual.length === 0) {
    return { dimension: "accuracy", score: 100, target: 80, details: "Empty case (correct)", passed: true };
  }

  let truePositives = 0;
  for (const exp of expected) {
    if (actual.some((a) =>
      a.name.toLowerCase().includes(exp.name.toLowerCase()) ||
      exp.name.toLowerCase().includes(a.name.toLowerCase())
    )) {
      truePositives++;
    }
  }

  const precision = actual.length > 0 ? truePositives / actual.length : 0;
  const recall = expected.length > 0 ? truePositives / expected.length : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const score = Math.round(f1 * 100);

  return {
    dimension: "accuracy",
    score,
    target: 80,
    details: `F1: ${score}/100 — precision: ${Math.round(precision * 100)}%, recall: ${Math.round(recall * 100)}%`,
    passed: score >= 80,
  };
}

// ---------------------------------------------------------------------------
// Cost scorer — within token budget?
// ---------------------------------------------------------------------------

export function scoreCost(
  evalCase: PodcastEvalCase,
  result: ExtractionResult
): ScorerResult {
  const maxTokens = evalCase.maxTokens ?? 2000;
  // Estimate tokens from JSON output size (rough: 4 chars ≈ 1 token)
  const outputStr = JSON.stringify(result.products ?? []);
  const estimatedTokens = Math.ceil(outputStr.length / 4);
  const pct = Math.round((estimatedTokens / maxTokens) * 100);
  const score = Math.max(0, 100 - Math.max(0, pct - 100));

  return {
    dimension: "cost",
    score,
    target: 80,
    details: `~${estimatedTokens} tokens (budget: ${maxTokens}). ${pct <= 100 ? "Within budget" : `${pct - 100}% over budget`}`,
    passed: score >= 80,
  };
}

export const ALL_SCORERS = [scoreEntityRecall, scoreValue, scoreAccuracy, scoreCost];
