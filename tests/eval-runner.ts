/**
 * Podcast Commerce MCP — Eval Runner
 *
 * Usage:
 *   npx tsx tests/eval-runner.ts               # fixture mode (mocked extractor)
 *   EVAL_LIVE=true npx tsx tests/eval-runner.ts # live mode (real OpenAI API)
 *
 * Fixture mode: injects a deterministic mock that returns all expectedProducts.
 * Live mode: calls extractProducts() with real OpenAI key from env.
 */

import type { PodcastEvalCase, EvalResult } from "./eval-types.js";
import { ALL_SCORERS } from "./eval-scorers.js";
import { ALL_CASES } from "./eval-cases/index.js";
import type { ExtractionResult } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixture mock — returns expectedProducts as ProductMentions
// ---------------------------------------------------------------------------

function mockExtraction(evalCase: PodcastEvalCase): ExtractionResult {
  return {
    episode_id: evalCase.id,
    products: evalCase.expectedProducts.map((ep) => ({
      name: ep.name,
      category: ep.category,
      confidence: 0.9,
      mention_context: "Mock extraction for fixture mode",
      recommendation_strength: "mentioned",
      affiliate_link: null,
    })),
    sponsor_segments: [],
    total_products: evalCase.expectedProducts.length,
    ai_cost_usd: 0,
  } as unknown as ExtractionResult;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runCase(
  evalCase: PodcastEvalCase,
  mode: "fixture" | "live"
): Promise<EvalResult> {
  const start = Date.now();
  let result: ExtractionResult;

  if (mode === "live") {
    const { extractProducts } = await import("../src/extractor.js");
    const extracted = await extractProducts({ transcript: evalCase.transcript });
    result = { ...extracted, _meta: { processing_time_ms: 0, ai_cost_usd: extracted.ai_cost_usd, cache_hit: false } } as unknown as ExtractionResult;
  } else {
    result = mockExtraction(evalCase);
  }

  const scores = ALL_SCORERS.map((scorer) => scorer(evalCase, result));
  const overallScore = Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length);

  return {
    caseId: evalCase.id,
    caseName: evalCase.name,
    timestamp: new Date().toISOString(),
    scores,
    overallScore,
    passed: scores.every((s) => s.passed),
    productsExtracted: result.products ?? [],
  };
}

async function main() {
  const mode = process.env.EVAL_LIVE === "true" ? "live" : "fixture";
  console.log(`\n🧪 Podcast Commerce MCP — Eval (mode: ${mode})\n`);

  const results: EvalResult[] = [];
  for (const evalCase of ALL_CASES) {
    process.stdout.write(`  ${evalCase.name}... `);
    try {
      const result = await runCase(evalCase, mode);
      results.push(result);
      const icon = result.passed ? "✅" : "❌";
      console.log(`${icon} ${result.overallScore}/100`);
      for (const s of result.scores) {
        const icon2 = s.passed ? "✓" : "✗";
        console.log(`     ${icon2} ${s.dimension}: ${s.score}/${s.target} — ${s.details}`);
      }
    } catch (err) {
      console.log(`💥 ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const avg = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.overallScore, 0) / results.length) : 0;
  console.log(`\n📊 ${passed}/${results.length} cases passed. Average score: ${avg}/100\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
