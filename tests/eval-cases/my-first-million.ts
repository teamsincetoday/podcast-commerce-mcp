/**
 * Eval case: My First Million — online business tools & affiliate opportunities.
 * Source: Representative of MFM format (mfmpod.com public episodes).
 * Known product categories: creator tools, ecommerce, newsletter, community platforms.
 * Tests: business tool extraction, affiliate link opportunity identification.
 */

import type { PodcastEvalCase } from "../eval-types.js";

export const myFirstMillionCase: PodcastEvalCase = {
  id: "mfm-creator-tools",
  name: "My First Million — Creator Economy Tools",
  source: "My First Million Podcast — public episode (mfmpod.com)",
  transcript: `
Sam: Okay, if someone wants to build a newsletter business in 2025, here's exactly what stack
I would use. Start on Beehiiv. Not Substack, not ConvertKit — Beehiiv. The reason is their
ad network pays way better and their analytics are legitimately best in class.

Shaan: I agree on Beehiiv. The boosts feature alone — where other newsletters pay to get
subscribers — is a game changer. I've seen newsletters generating $5k a month just from
letting other newsletters boost them.

Sam: For the community side, we've tried Circle, Mighty Networks, and Kajabi. Circle wins.
It's the cleanest interface and the integrations are solid. If you're doing courses alongside
community, Kajabi is worth considering but it's more expensive.

Shaan: For ecommerce, if you're selling physical products, Shopify is still the answer.
There's no close second. And if you want to add affiliate revenue to any of these businesses,
ShareASale and Impact are the two affiliate networks I'd actually use. Amazon Associates is
table stakes but the commissions are tiny.

Sam: The tool I use every single day that no one talks about is Loom. For async video
communication with my team, with founders we're evaluating, with anyone. Loom has completely
replaced a huge percentage of meetings for us. Gong is what we use for recording actual
sales calls — transcription and AI coaching built in.

Shaan: One more — if you're doing content creation and you want to transcribe your own
podcasts to repurpose on LinkedIn, Descript is amazing. You can edit the audio by editing
the text. Game changer for repurposing content.
`.trim(),
  expectedProducts: [
    { name: "Beehiiv", category: "saas", required: true },
    { name: "Circle", category: "saas", required: true },
    { name: "Shopify", category: "saas", required: true },
    { name: "Loom", category: "saas", required: true },
    { name: "ShareASale", category: "affiliate", required: false },
    { name: "Kajabi", category: "saas", required: false },
    { name: "Descript", category: "saas", required: false },
    { name: "Gong", category: "saas", required: false },
    { name: "ConvertKit", category: "saas", required: false },
  ],
  maxTokens: 2000,
};
