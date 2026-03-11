/**
 * Eval case: Business/finance podcast with explicit sponsors + organic mentions.
 *
 * Tests: sponsor detection, CTA extraction, organic-vs-sponsored classification.
 *
 * Ground truth:
 *   Sponsors: Shopify, HubSpot
 *   Organic products: Calendly, Stripe, Beehiiv
 */

import type { PodcastEvalCase } from "../types.js";

export const SPONSORED_PODCAST_TRANSCRIPT = `
HOST: This episode is brought to you by Shopify. Whether you're launching a new product
or scaling to millions in revenue, Shopify is the commerce platform built for entrepreneurs.
Go to shopify.com slash podcast for a free trial. I've used Shopify for my own store for
three years and the App Store alone is worth it — thousands of integrations.

GUEST: The merchant experience on Shopify really is exceptional. I've helped migrate
probably a dozen brands from WooCommerce and the conversion rate improvements are
immediate. The checkout experience is just better.

HOST: Quick break — this part of the show is sponsored by HubSpot. If you're still
managing your CRM in spreadsheets, I genuinely feel bad for you. HubSpot's free CRM
is genuinely free, genuinely powerful, and their email sequences have driven a measurable
uptick in our sales pipeline. Check it out at hubspot.com.

HOST: Okay, back to the conversation. You were saying about customer acquisition costs?

GUEST: Right. What we're seeing is that email is still the highest ROI channel by far.
We switched to Beehiiv for our newsletter platform about eight months ago and the
growth tools alone have been worth it — the referral program they built in is remarkable.
We grew from forty thousand to over a hundred thousand subscribers in six months.

HOST: The analytics in Beehiiv are also great. You actually know where readers are
coming from. What about payment processing?

GUEST: We use Stripe for everything. It's just the standard at this point. Yes you can
find cheaper processors but the developer experience, the fraud protection, the global
coverage — Stripe is worth the basis points. And Calendly for scheduling has been a
silent productivity win. We estimate we save probably four hours per week per salesperson
on scheduling back-and-forth.

HOST: I keep hearing Calendly mentioned. I'm still using it personally for guest booking
actually. It's one of those tools that just works and you forget it's even there.
`;

export const sponsoredBusinessPodcast: PodcastEvalCase = {
  id: "sponsored-business-podcast",
  name: "Business Podcast — Dual Sponsors + Organic",
  description:
    "Business podcast with 2 explicit sponsors and 3 organic product mentions. Tests sponsor segment extraction and organic/sponsored distinction.",
  transcript: SPONSORED_PODCAST_TRANSCRIPT,
  episodeId: "business-sponsored-001",
  expectedProducts: [
    { name: "Shopify",    category: "saas",           required: true,  minStrength: "strong" },
    { name: "HubSpot",    category: "saas",           required: true,  minStrength: "strong" },
    { name: "Beehiiv",    category: "saas",           required: true,  minStrength: "strong" },
    { name: "Stripe",     category: "saas",           required: true,  minStrength: "strong" },
    { name: "Calendly",   category: "saas",           required: true,  minStrength: "moderate" },
  ],
  expectedSponsors: [
    { name: "Shopify",  required: true },
    { name: "HubSpot",  required: true },
  ],
  maxCostUsd: 0.01,
};
