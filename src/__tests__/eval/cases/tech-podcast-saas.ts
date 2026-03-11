/**
 * Eval case: Tech/startup podcast — SaaS and AI tools focus.
 *
 * Modeled on All-In, My First Million, or Lenny's Podcast style content.
 * Ground truth: 6 product mentions, 0 sponsors.
 *
 * Expected products (required):
 *   - Linear (saas, strong)
 *   - Notion (saas, strong)
 *   - Slack (saas, moderate)
 *   - Figma (saas, moderate)
 *   - Cursor (saas, strong)
 *   - Perplexity (saas, moderate)
 */

import type { PodcastEvalCase } from "../types.js";

export const TECH_PODCAST_TRANSCRIPT = `
CHAMATH: I want to talk about productivity tools because I think this is actually an underrated
competitive advantage for early-stage startups. The tooling gap between the best operators
and average operators is enormous.

JASON: Totally agree. What are you using right now?

CHAMATH: So my team has almost entirely moved to Linear for project management. We tried
Jira, we tried Asana, and honestly nothing comes close to the speed of Linear. The keyboard
shortcuts, the cycle management, the Git integration — it just gets out of your way.

JASON: We went all-in on Notion. I know some people love Linear but we use Notion for
everything — our wiki, project tracking, meeting notes, CRM almost. The AI features
they added are genuinely useful. Not just marketing AI, actually useful.

CHAMATH: Notion's great for documentation. For async communication my team still lives
in Slack — we have threads for every project, and with the new AI Slack summarization
it's actually manageable. But I'm concerned about Slack's direction honestly.

JASON: What about design? Are you using Figma?

CHAMATH: Figma has totally won design. I don't know a single serious product team that
isn't on Figma at this point. The collaboration layer is just incomparable.

JASON: What I'm really excited about is Cursor. Have you tried it?

CHAMATH: Yes! We adopted Cursor company-wide two months ago. The code completion is
extraordinary — I know people say that about every AI coding tool but this is different.
Senior engineers on my team are saying it's a 30-40% productivity improvement. That's
not a marginal gain, that's fundamental.

JASON: Same experience. And then for research I've been using Perplexity instead of
Google for probably six months now. The citation-based answers are so much more useful
for business research. I pay for the Pro subscription and it's worth every penny.

CHAMATH: The way I see it, the startups that adopt the right tooling in 2026 are going
to have a structural cost advantage. Less headcount needed for the same output.
`;

export const techPodcastSaas: PodcastEvalCase = {
  id: "tech-podcast-saas",
  name: "Tech Podcast — SaaS Tool Recommendations",
  description:
    "All-In style tech podcast discussion of startup tooling. Tests SaaS product extraction with no sponsors — pure organic recommendations.",
  transcript: TECH_PODCAST_TRANSCRIPT,
  episodeId: "tech-saas-001",
  expectedProducts: [
    { name: "Linear",      category: "saas", required: true,  minStrength: "strong" },
    { name: "Notion",      category: "saas", required: true,  minStrength: "strong" },
    { name: "Slack",       category: "saas", required: true,  minStrength: "moderate" },
    { name: "Figma",       category: "saas", required: true,  minStrength: "moderate" },
    { name: "Cursor",      category: "saas", required: true,  minStrength: "strong" },
    { name: "Perplexity",  category: "saas", required: true,  minStrength: "moderate" },
    { name: "Jira",        category: "saas", required: false },
    { name: "Asana",       category: "saas", required: false },
  ],
  expectedSponsors: [],
  maxCostUsd: 0.01,
};
