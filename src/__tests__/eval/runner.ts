/**
 * Eval runner — score a single eval case against extraction results.
 */

import type {
  PodcastEvalCase,
  EvalResult,
  EvalReport,
  EvalMetrics,
  ImprovementPriority,
  ExtractionResult,
} from "./types.js";
import { ALL_SCORERS } from "./scorers/index.js";

export function scoreCase(
  evalCase: PodcastEvalCase,
  result: ExtractionResult,
  durationMs: number,
): EvalResult {
  const scores = ALL_SCORERS.map(scorer => scorer(evalCase, result));

  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  const overallScore = totalWeight > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight)
    : 0;

  const passed = scores.every(s => s.passed);

  // Compute metrics for value narrative fill-in
  const products = result.products;
  const avgConf = products.length > 0
    ? products.reduce((sum, p) => sum + p.confidence, 0) / products.length
    : 0;
  const affiliateMatches = products.filter(p => p.affiliate_link !== null).length;

  // F1 from accuracy scorer
  const accuracyScore = scores.find(s => s.dimension === "accuracy");
  const detailsMatch = accuracyScore?.details.match(/F1=(\d+)/);
  const precisionMatch = accuracyScore?.details.match(/P=(\d+)/);
  const recallMatch = accuracyScore?.details.match(/R=(\d+)/);

  const metrics: EvalMetrics = {
    entity_count: products.length,
    sponsor_count: result.sponsor_segments.length,
    avg_confidence: Math.round(avgConf * 100) / 100,
    latency_ms: durationMs,
    cost_usd: result._meta.ai_cost_usd,
    affiliate_matches: affiliateMatches,
    precision: precisionMatch ? parseInt(precisionMatch[1]!, 10) / 100 : 0,
    recall: recallMatch ? parseInt(recallMatch[1]!, 10) / 100 : 0,
    f1: detailsMatch ? parseInt(detailsMatch[1]!, 10) / 100 : 0,
  };

  return {
    caseId: evalCase.id,
    caseName: evalCase.name,
    timestamp: new Date().toISOString(),
    mode: "fixture",
    scores,
    overallScore,
    passed,
    durationMs,
    metrics,
  };
}

export function buildReport(results: EvalResult[], mode: "fixture" | "live"): EvalReport {
  const totalCases = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = totalCases - passed;

  const dimensionSums: Record<string, { total: number; count: number }> = {};
  for (const result of results) {
    for (const score of result.scores) {
      if (!dimensionSums[score.dimension]) {
        dimensionSums[score.dimension] = { total: 0, count: 0 };
      }
      dimensionSums[score.dimension]!.total += score.score;
      dimensionSums[score.dimension]!.count++;
    }
  }

  const dimensionAverages: Record<string, number> = {};
  for (const [dim, { total, count }] of Object.entries(dimensionSums)) {
    dimensionAverages[dim] = Math.round(total / count);
  }

  const overallScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.overallScore, 0) / results.length)
    : 0;

  // Aggregated metrics across all cases
  const metricsResults = results.filter(r => r.metrics);
  const aggregatedMetrics = {
    avg_entity_count: metricsResults.length > 0
      ? Math.round(metricsResults.reduce((sum, r) => sum + r.metrics!.entity_count, 0) / metricsResults.length)
      : 0,
    avg_latency_ms: metricsResults.length > 0
      ? Math.round(metricsResults.reduce((sum, r) => sum + r.metrics!.latency_ms, 0) / metricsResults.length)
      : 0,
    avg_cost_usd: metricsResults.length > 0
      ? metricsResults.reduce((sum, r) => sum + r.metrics!.cost_usd, 0) / metricsResults.length
      : 0,
    avg_f1: metricsResults.length > 0
      ? Math.round(metricsResults.reduce((sum, r) => sum + r.metrics!.f1, 0) / metricsResults.length * 100) / 100
      : 0,
    avg_confidence: metricsResults.length > 0
      ? Math.round(metricsResults.reduce((sum, r) => sum + r.metrics!.avg_confidence, 0) / metricsResults.length * 100) / 100
      : 0,
    total_affiliate_matches: metricsResults.reduce((sum, r) => sum + (r.metrics?.affiliate_matches ?? 0), 0),
  };

  // Improvement priorities
  const priorities: ImprovementPriority[] = [];
  for (const result of results) {
    for (const score of result.scores) {
      if (score.score < score.target) {
        const gap = score.target - score.score;
        const weightedGap = gap * score.weight;
        priorities.push({
          dimension: `${score.dimension} (${result.caseName})`,
          gap,
          weightedGap,
          suggestion: getSuggestion(score.dimension, gap),
        });
      }
    }
  }
  priorities.sort((a, b) => b.weightedGap - a.weightedGap);

  return {
    timestamp: new Date().toISOString(),
    mode,
    results,
    summary: { totalCases, passed, failed, overallScore, dimensionAverages },
    aggregatedMetrics,
    priorities: priorities.slice(0, 10),
  };
}

function getSuggestion(dimension: string, gap: number): string {
  const suggestions: Record<string, string> = {
    accuracy: "Improve extraction prompt — add examples of products to include/exclude",
    value: "Increase minimum entity threshold in extraction or improve confidence calibration",
    cost: "Optimize prompt length — check transcript truncation settings",
  };
  return suggestions[dimension] ?? `Improve ${dimension} (gap: ${gap} points)`;
}
