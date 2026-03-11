/**
 * All scorers for podcast-commerce-mcp eval framework.
 */

export { scoreAccuracy } from "./accuracy-scorer.js";
export { scoreValue } from "./value-scorer.js";
export { scoreCost } from "./cost-scorer.js";

import type { ScorerResult, PodcastEvalCase, ExtractionResult } from "../types.js";
import { scoreAccuracy } from "./accuracy-scorer.js";
import { scoreValue } from "./value-scorer.js";
import { scoreCost } from "./cost-scorer.js";

export type ScorerFn = (evalCase: PodcastEvalCase, result: ExtractionResult) => ScorerResult;

export const ALL_SCORERS: ScorerFn[] = [
  scoreAccuracy,
  scoreValue,
  scoreCost,
];
