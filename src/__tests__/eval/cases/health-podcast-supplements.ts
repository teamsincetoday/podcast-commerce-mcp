/**
 * Eval case: Health & performance podcast — supplement and equipment focus.
 *
 * Modeled on Huberman Lab / Tim Ferriss style content.
 * Ground truth: 7 product mentions, 1 sponsor.
 *
 * Expected products (required):
 *   - Athletic Greens (supplement, strong) — AG1 is the product abbreviation, same entity
 *   - Momentous Omega-3 (supplement, strong)
 *   - Whoop (physical_goods, strong)
 *   - Thorne Research (supplement, moderate)
 *   - Eight Sleep (physical_goods, moderate)
 *
 * Optional (may be extracted):
 *   - Rogue Fitness (physical_goods)
 *   - Oura Ring (physical_goods) — mentioned as secondary option to Whoop
 *
 * NOT in expected: AG1 — brand abbreviation for Athletic Greens (same entity, already required).
 * A correct extractor extracts one entity per product, not both the name and its abbreviation.
 */

import type { PodcastEvalCase } from "../types.js";

export const HEALTH_PODCAST_TRANSCRIPT = `
Welcome back to the show. Before we dive in, I want to thank today's sponsor, Athletic Greens.
I've been taking AG1 every morning for the past three years. One scoop in water and you've got
your foundational nutrition covered — 75 vitamins, minerals, and whole-food sourced nutrients.
If you go to athleticgreens.com slash podcast you'll get a free year supply of vitamin D3 K2
and five free travel packs. I genuinely take this every single day.

Now let's get into today's topic. My guest today has spent fifteen years studying sleep
optimization and we're going to cover everything from sleep tracking to supplementation
to temperature protocols.

HOST: So let's start with sleep tracking. What's the evidence base?

GUEST: The data on consumer wearables is actually pretty solid now. I've been using the
Whoop 4.0 for about six months and the sleep staging accuracy is remarkable compared to
polysomnography. The recovery score is genuinely predictive of performance. If you want
to go cheaper, the Oura Ring is also quite good, but for serious athletes I recommend Whoop.

HOST: What about temperature? I know you're a fan of the Eight Sleep pod.

GUEST: The Eight Sleep Pod Pro has been probably the biggest intervention for my sleep
quality. The ability to set different temperatures for each side of the bed — my wife
and I have completely different preferences — and the automatic temperature adjustment
throughout the night based on your sleep stages is incredible. Expensive but worth it.

HOST: Let's talk supplements. What's your non-negotiable stack?

GUEST: First is omega-3 fatty acids. Most people are chronically deficient. I recommend
Momentous Omega-3 — they use a triglyceride form which has much better absorption than
the cheaper ethyl ester form you find in most fish oil products. For a general multivitamin
foundation, I use Thorne Research. They do third-party testing and the quality control is
excellent — important for athletes who need NSF certified products.

HOST: Any resistance training equipment you'd recommend for home gyms?

GUEST: If you're serious about building a home gym, Rogue Fitness is the gold standard.
Yes it's expensive, but the quality is extraordinary and it'll outlast you. Their barbells
alone are worth the investment.
`;

export const healthPodcastSupplements: PodcastEvalCase = {
  id: "health-podcast-supplements",
  name: "Health Podcast — Supplement & Equipment Focus",
  description:
    "Huberman-style health/performance podcast. Tests extraction of supplements, wearables, sleep tech, and equipment. 1 clear sponsor (AG1).",
  transcript: HEALTH_PODCAST_TRANSCRIPT,
  episodeId: "health-supplements-001",
  expectedProducts: [
    { name: "Athletic Greens",  category: "supplement",      required: true,  minStrength: "strong" },
    { name: "Whoop",            category: "physical_goods",  required: true,  minStrength: "strong" },
    { name: "Eight Sleep",      category: "physical_goods",  required: true,  minStrength: "strong" },
    { name: "Momentous",        category: "supplement",      required: true,  minStrength: "moderate" },
    { name: "Thorne",           category: "supplement",      required: true,  minStrength: "moderate" },
    { name: "Rogue Fitness",    category: "physical_goods",  required: false },
    { name: "Oura Ring",        category: "physical_goods",  required: false },
  ],
  expectedSponsors: [
    { name: "Athletic Greens", required: true },
  ],
  maxCostUsd: 0.01,
};
