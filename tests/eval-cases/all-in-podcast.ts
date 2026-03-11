/**
 * Eval case: All-In Podcast — tech & SaaS product discussion.
 * Source: Representative of All-In format (allinchamath.com public episodes).
 * Known product categories: SaaS tools, AI companies, fintech.
 * Tests: tech/SaaS category extraction, non-sponsor product mentions.
 */

import type { PodcastEvalCase } from "../eval-types.js";

export const allInPodcastCase: PodcastEvalCase = {
  id: "all-in-tech-saas",
  name: "All-In Podcast — SaaS & AI Product Discussion",
  source: "All-In Podcast — public episode (allinpodcast.co)",
  transcript: `
Jason: Okay let's talk about the tools we're actually using day to day. Sacks, you mentioned
you've gone all in on Notion for the firm. What does that workflow look like?

Sacks: Yeah, so we use Notion for basically everything at Craft Ventures. Deal flow, portfolio
updates, investment memos. We tried Airtable for a while but Notion is just more flexible.
The AI features they've added are actually pretty good now.

Chamath: I'm still a heavy Google Workspace user. But I have to say, Perplexity has completely
changed how I do research. I barely use Google Search anymore. For any market research on a
company, I just go to Perplexity. It's faster and more accurate.

Friedberg: For the ag-tech stuff at The Production Board, we use a lot of specialized tools.
But for general productivity, I think the Anthropic Claude API is genuinely the best
reasoning model for complex analysis right now. We're integrating it into several portfolio
companies' workflows.

Jason: I've been using Linear for project management — it's so much better than Jira. And
for communication, we moved the whole All-In team to Slack. But honestly the tool I recommend
to every founder is Mercury bank. Zero fees, great API, built for startups.

Sacks: Mercury is great. For payments, Stripe is still the default but I've seen more
startups looking at Brex for their spend management. Brex's rewards program is actually
quite good if you're spending on AWS or Google Cloud.
`.trim(),
  expectedProducts: [
    { name: "Notion", category: "saas", required: true },
    { name: "Perplexity", category: "saas", required: true },
    { name: "Linear", category: "saas", required: true },
    { name: "Mercury", category: "service", required: true },
    { name: "Slack", category: "saas", required: false },
    { name: "Stripe", category: "service", required: false },
    { name: "Brex", category: "service", required: false },
    { name: "Airtable", category: "saas", required: false },
  ],
  maxTokens: 2000,
};
