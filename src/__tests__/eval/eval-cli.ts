#!/usr/bin/env tsx
/**
 * Podcast Commerce MCP — Eval CLI
 *
 * Usage:
 *   cd /home/jonathan/podcast-commerce-mcp
 *   npx tsx src/__tests__/eval/eval-cli.ts              # fixture (synthetic, instant)
 *   EVAL_LIVE=true npx tsx src/__tests__/eval/eval-cli.ts   # live (real OpenAI calls)
 *
 * Live mode output is saved to:
 *   src/__tests__/eval/reports/YYYY-MM-DD.json
 *
 * Use the aggregatedMetrics in the report to fill in production/value-narratives.md.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PODCAST_EVAL_CASES } from "./cases/index.js";
import { scoreCase, buildReport } from "./runner.js";
import type { EvalResult } from "./types.js";
import type { ExtractionResult } from "../../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, "reports");

const isLive = process.env["EVAL_LIVE"] === "true";
const mode = isLive ? "live" : "fixture";

async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  console.log(`\n🎙  Podcast Commerce MCP — Eval Suite (${mode} mode)\n`);
  console.log("─".repeat(60));

  const results: EvalResult[] = [];

  for (const evalCase of ALL_PODCAST_EVAL_CASES) {
    console.log(`\n▸ ${evalCase.name}`);

    let extractionResult: ExtractionResult;
    const startTime = Date.now();

    try {
      if (isLive) {
        extractionResult = await runLive(evalCase.transcript, evalCase.episodeId);
      } else {
        extractionResult = buildFixture(evalCase.episodeId, evalCase.expectedProducts.length);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ERROR: ${errMsg}`);
      results.push({
        caseId: evalCase.id,
        caseName: evalCase.name,
        timestamp: new Date().toISOString(),
        mode,
        scores: [],
        overallScore: 0,
        passed: false,
        durationMs: Date.now() - startTime,
        error: errMsg,
      });
      continue;
    }

    const durationMs = Date.now() - startTime;
    const evalResult = scoreCase(evalCase, extractionResult, durationMs);
    evalResult.mode = mode;
    results.push(evalResult);

    const status = evalResult.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`  ${status}  (score: ${evalResult.overallScore}/100, ${durationMs}ms)`);
    for (const s of evalResult.scores) {
      const ind = s.passed ? "✓" : "✗";
      console.log(`    ${ind} ${s.dimension}: ${s.score}/${s.target} — ${s.details}`);
    }
    if (evalResult.metrics) {
      const m = evalResult.metrics;
      console.log(`    📊 entities=${m.entity_count}, conf=${m.avg_confidence}, F1=${(m.f1 * 100).toFixed(0)}, cost=$${m.cost_usd.toFixed(5)}`);
    }
  }

  const report = buildReport(results, mode);

  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log(`PODCAST EVAL SUMMARY  (${mode} mode)`);
  console.log("═".repeat(60));
  console.log(`Cases: ${report.summary.passed}/${report.summary.totalCases} passed`);
  console.log(`Overall score: ${report.summary.overallScore}/100`);
  console.log("\nDimension averages:");
  for (const [dim, avg] of Object.entries(report.summary.dimensionAverages)) {
    console.log(`  ${dim}: ${avg}/100`);
  }

  const m = report.aggregatedMetrics;
  console.log("\nAggregated metrics (for value-narratives.md fill-in):");
  console.log(`  avg_entity_count:    ${m.avg_entity_count}`);
  console.log(`  avg_latency_ms:      ${m.avg_latency_ms}`);
  console.log(`  avg_cost_usd:        $${m.avg_cost_usd.toFixed(5)}`);
  console.log(`  avg_f1:              ${(m.avg_f1 * 100).toFixed(0)}%`);
  console.log(`  avg_confidence:      ${m.avg_confidence}`);
  console.log(`  total_affiliate_matches: ${m.total_affiliate_matches}`);

  // Revenue estimate (Remi's formula)
  const revenuePerEpisode = m.avg_entity_count * 0.05 * 65;
  console.log(`\n  💰 Revenue estimate: $${revenuePerEpisode.toFixed(2)}/episode`);
  console.log(`     (${m.avg_entity_count} entities × 5% commission × $65 avg product price)`);

  if (report.priorities.length > 0) {
    console.log("\nImprovement priorities:");
    for (const p of report.priorities.slice(0, 5)) {
      console.log(`  [${p.weightedGap.toFixed(1)}] ${p.dimension}: ${p.suggestion}`);
    }
  }

  // Write report
  const dateStr = new Date().toISOString().slice(0, 10);
  const reportPath = resolve(REPORTS_DIR, `${dateStr}-${mode}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport: ${reportPath}`);

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

async function runLive(transcript: string, episodeId: string): Promise<ExtractionResult> {
  const { extractProducts } = await import("../../extractor.js");

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY required for live eval mode");

  // Set env var so extractor picks it up
  process.env["OPENAI_API_KEY"] = apiKey;

  const startTs = Date.now();
  const raw = await extractProducts({ transcript, episodeId });
  const processingMs = Date.now() - startTs;

  // Build ExtractionResult (add _meta)
  return {
    episode_id: raw.episode_id,
    products: raw.products,
    sponsor_segments: raw.sponsor_segments,
    _meta: {
      processing_time_ms: processingMs,
      ai_cost_usd: raw.ai_cost_usd,
      cache_hit: false,
    },
  };
}

function buildFixture(episodeId: string, expectedCount: number): ExtractionResult {
  // Synthetic fixture for fast non-live testing
  const products = Array.from({ length: Math.max(expectedCount, 3) }, (_, i) => ({
    name: `Product ${i + 1}`,
    category: "saas" as const,
    mention_context: "Mentioned in fixture",
    speaker: "host" as string | null,
    confidence: 0.80,
    recommendation_strength: "moderate" as const,
    affiliate_link: null as string | null,
    mention_count: 1,
  }));

  return {
    episode_id: episodeId,
    products,
    sponsor_segments: [],
    _meta: {
      processing_time_ms: 10,
      ai_cost_usd: 0.001,
      cache_hit: false,
    },
  };
}

main().catch(err => {
  console.error("Eval failed:", err);
  process.exit(1);
});
