/**
 * Value scorer — is this output actionable for an agent?
 *
 * Checks:
 *   - entity_count >= 3 (enough signal to act on)
 *   - avg_confidence >= 0.70 (trustworthy extractions)
 *   - at least one "strong" recommendation (not all neutral mentions)
 *   - sponsor extraction works (if sponsors expected)
 *
 * Target: 70/100
 */

import type { ScorerResult, PodcastEvalCase, ExtractionResult } from "../types.js";

export function scoreValue(
  evalCase: PodcastEvalCase,
  result: ExtractionResult,
): ScorerResult {
  const products = result.products;
  const sponsors = result.sponsor_segments;

  let score = 0;
  const notes: string[] = [];

  // 1. Entity count (25 pts): >= 3 = 25pts, 2 = 15pts, 1 = 5pts, 0 = 0pts
  if (products.length >= 3) {
    score += 25;
    notes.push(`entities=${products.length} ✓`);
  } else if (products.length === 2) {
    score += 15;
    notes.push(`entities=${products.length} (low)`);
  } else if (products.length === 1) {
    score += 5;
    notes.push(`entities=${products.length} (very low)`);
  } else {
    notes.push("entities=0 ✗");
  }

  // 2. Average confidence (25 pts): >= 0.75 = 25pts, >= 0.60 = 15pts, else 0pts
  const avgConf = products.length > 0
    ? products.reduce((sum, p) => sum + p.confidence, 0) / products.length
    : 0;
  if (avgConf >= 0.75) {
    score += 25;
    notes.push(`conf=${avgConf.toFixed(2)} ✓`);
  } else if (avgConf >= 0.60) {
    score += 15;
    notes.push(`conf=${avgConf.toFixed(2)} (moderate)`);
  } else {
    notes.push(`conf=${avgConf.toFixed(2)} ✗`);
  }

  // 3. Recommendation strength signal (25 pts): at least one "strong"
  const hasStrong = products.some(p => p.recommendation_strength === "strong");
  const hasModerate = products.some(p => p.recommendation_strength === "moderate");
  if (hasStrong) {
    score += 25;
    notes.push("strong_rec ✓");
  } else if (hasModerate) {
    score += 12;
    notes.push("moderate_rec (no strong)");
  } else {
    notes.push("no_strong_rec ✗");
  }

  // 4. Sponsor extraction (25 pts): if expected, were any found?
  if (evalCase.expectedSponsors.length === 0) {
    // No sponsors expected — full marks (no penalty for not finding what's not there)
    score += 25;
    notes.push("sponsors=n/a ✓");
  } else {
    const foundRequiredSponsors = evalCase.expectedSponsors
      .filter(s => s.required)
      .filter(s =>
        sponsors.some(found =>
          found.sponsor_name.toLowerCase().includes(s.name.toLowerCase()) ||
          s.name.toLowerCase().includes(found.sponsor_name.toLowerCase())
        )
      ).length;
    const requiredCount = evalCase.expectedSponsors.filter(s => s.required).length;
    if (requiredCount === 0 || foundRequiredSponsors === requiredCount) {
      score += 25;
      notes.push(`sponsors=${sponsors.length} ✓`);
    } else {
      score += Math.round(25 * foundRequiredSponsors / requiredCount);
      notes.push(`sponsors=${foundRequiredSponsors}/${requiredCount} required`);
    }
  }

  return {
    dimension: "value",
    score,
    target: 70,
    weight: 0.35,
    details: notes.join(", "),
    passed: score >= 70,
  };
}
