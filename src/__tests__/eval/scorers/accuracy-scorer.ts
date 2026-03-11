/**
 * Accuracy scorer — precision / recall / F1 vs ground truth expected products.
 *
 * Target: F1 >= 0.80
 */

import type { ScorerResult, PodcastEvalCase, ExtractionResult } from "../types.js";

export function scoreAccuracy(
  evalCase: PodcastEvalCase,
  result: ExtractionResult,
): ScorerResult {
  const expected = evalCase.expectedProducts;
  const actual = result.products;

  if (expected.length === 0 && actual.length === 0) {
    return {
      dimension: "accuracy",
      score: 100,
      target: 80,
      weight: 0.40,
      details: "No products expected or found (correct)",
      passed: true,
    };
  }

  // True positives: actual products that match an expected product
  let truePositives = 0;
  const matchedExpected = new Set<number>();

  for (const act of actual) {
    for (let i = 0; i < expected.length; i++) {
      if (matchedExpected.has(i)) continue;
      const exp = expected[i]!;
      const nameMatch = act.name.toLowerCase().includes(exp.name.toLowerCase()) ||
        exp.name.toLowerCase().includes(act.name.toLowerCase());
      if (nameMatch) {
        truePositives++;
        matchedExpected.add(i);
        break;
      }
    }
  }

  const precision = actual.length > 0 ? truePositives / actual.length : 0;
  const recall = expected.length > 0 ? truePositives / expected.length : 0;
  const f1 = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  // Required-entity recall (harder gate)
  const required = expected.filter(e => e.required);
  let requiredFound = 0;
  for (const req of required) {
    const found = actual.some(a =>
      a.name.toLowerCase().includes(req.name.toLowerCase()) ||
      req.name.toLowerCase().includes(a.name.toLowerCase())
    );
    if (found) requiredFound++;
  }
  const requiredRecall = required.length > 0 ? requiredFound / required.length : 1;

  // Score: 60% F1 + 40% required-entity recall, scaled to 0-100
  const rawScore = (f1 * 0.6 + requiredRecall * 0.4) * 100;
  const score = Math.round(rawScore);

  return {
    dimension: "accuracy",
    score,
    target: 80,
    weight: 0.40,
    details: `F1=${(f1 * 100).toFixed(0)} (P=${(precision * 100).toFixed(0)}, R=${(recall * 100).toFixed(0)}). Required: ${requiredFound}/${required.length}. Found: ${actual.length}, Expected: ${expected.length}.`,
    passed: score >= 80,
  };
}
