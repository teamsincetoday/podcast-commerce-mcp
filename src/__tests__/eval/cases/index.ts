/**
 * All podcast eval cases — exported as a flat array for the runner.
 */

export { healthPodcastSupplements } from "./health-podcast-supplements.js";
export { techPodcastSaas } from "./tech-podcast-saas.js";
export { sponsoredBusinessPodcast } from "./sponsored-business-podcast.js";

import { healthPodcastSupplements } from "./health-podcast-supplements.js";
import { techPodcastSaas } from "./tech-podcast-saas.js";
import { sponsoredBusinessPodcast } from "./sponsored-business-podcast.js";
import type { PodcastEvalCase } from "../types.js";

export const ALL_PODCAST_EVAL_CASES: PodcastEvalCase[] = [
  healthPodcastSupplements,
  techPodcastSaas,
  sponsoredBusinessPodcast,
];
