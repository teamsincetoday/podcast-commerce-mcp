/**
 * Cost scorer — is the extraction cost within budget?
 *
 * Target: cost <= maxCostUsd (default 0.01)
 * Score: 100 if under budget, decays linearly to 0 at 3× budget.
 */

import type { ScorerResult, PodcastEvalCase, ExtractionResult } from "../types.js";

export function scoreCost(
  evalCase: PodcastEvalCase,
  result: ExtractionResult,
): ScorerResult {
  const budget = evalCase.maxCostUsd ?? 0.01;
  const actual = result._meta.ai_cost_usd;

  let score: number;
  if (actual <= budget) {
    score = 100;
  } else {
    // Linear decay from 100 (at budget) to 0 (at 3× budget)
    const overRatio = (actual - budget) / (budget * 2);
    score = Math.max(0, Math.round(100 * (1 - overRatio)));
  }

  return {
    dimension: "cost",
    score,
    target: 80,
    weight: 0.25,
    details: `cost=$${actual.toFixed(5)} (budget=$${budget.toFixed(4)})${actual <= budget ? " ✓" : " ✗"}`,
    passed: actual <= budget,
  };
}
