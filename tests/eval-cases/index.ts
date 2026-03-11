export { hubermanLabCase } from "./huberman-lab.js";
export { allInPodcastCase } from "./all-in-podcast.js";
export { myFirstMillionCase } from "./my-first-million.js";

import { hubermanLabCase } from "./huberman-lab.js";
import { allInPodcastCase } from "./all-in-podcast.js";
import { myFirstMillionCase } from "./my-first-million.js";
import type { PodcastEvalCase } from "../eval-types.js";

export const ALL_CASES: PodcastEvalCase[] = [
  hubermanLabCase,
  allInPodcastCase,
  myFirstMillionCase,
];
