/**
 * Sentiment Scorer — pattern-based recommendation strength scoring.
 *
 * Scores product recommendations from 0-1 based on language signals in context.
 * No external API required — pure pattern matching for deterministic, fast results.
 */

import type { RecommendationVerdict } from "./types.js";

// ============================================================================
// SIGNAL PATTERNS
// ============================================================================

const STRONG_POSITIVE_SIGNALS = [
  /\b(love|amazing|game.?changer|changed my life|highly recommend|must.?have|obsessed|incredible|fantastic|outstanding|best|essential|life.?changing|blown away|blew my mind|absolutely|can't live without|swear by)\b/i,
];

const MODERATE_POSITIVE_SIGNALS = [
  /\b(like|good|useful|worth it|recommend|helpful|solid|decent|pretty good|not bad|enjoy|nice|works well|impressed|satisfied|happy with|fan of|big fan|really like|been using|use daily|use every)\b/i,
];

const SPONSOR_SIGNALS = [
  /\b(sponsor|brought to you by|use code|discount|paid partnership|partnership|ad|advertisement|promo code|affiliate|supported by|thanks to our sponsor|today's sponsor|check out the link|special offer|exclusive deal)\b/i,
];

const WARNING_SIGNALS = [
  /\b(avoid|don't buy|disappointed|returned|refund|waste|terrible|awful|horrible|scam|overpriced|not worth|regret|cancel|cancelled|unsubscribed|stopped using|gave up on|switched away from)\b/i,
];

// Speaker role multipliers
const SPEAKER_ROLE_MULTIPLIERS: Record<string, number> = {
  host: 1.0,
  guest: 0.9,
  sponsor: 0.5, // sponsor reads are lower-trust
};

// ============================================================================
// SCORING
// ============================================================================

/**
 * Score the recommendation strength of a product mention context.
 *
 * @param mentionContext - The text surrounding the product mention
 * @param speakerRole - Optional: "host", "guest", or "sponsor"
 * @param productName - Optional: product name to look for repetition
 * @returns { score, signals, verdict }
 */
export function scoreRecommendation(
  mentionContext: string,
  speakerRole?: string,
  _productName?: string,
): { score: number; signals: string[]; verdict: RecommendationVerdict } {
  const signals: string[] = [];
  let rawScore = 0;

  // Check warning signals first (they override positive)
  let hasWarning = false;
  for (const pattern of WARNING_SIGNALS) {
    if (pattern.test(mentionContext)) {
      hasWarning = true;
      signals.push("warning_language");
      break;
    }
  }

  if (hasWarning) {
    return {
      score: 0.1,
      signals,
      verdict: "warning",
    };
  }

  // Check sponsor signals
  let hasSponsorRead = false;
  for (const pattern of SPONSOR_SIGNALS) {
    if (pattern.test(mentionContext)) {
      hasSponsorRead = true;
      signals.push("sponsor_language");
      rawScore += 0.3; // sponsors are mentions but not organic endorsements
      break;
    }
  }

  // Check strong positive signals
  for (const pattern of STRONG_POSITIVE_SIGNALS) {
    if (pattern.test(mentionContext)) {
      signals.push("strong_positive");
      rawScore += 0.5;
      break;
    }
  }

  // Check moderate positive signals
  for (const pattern of MODERATE_POSITIVE_SIGNALS) {
    if (pattern.test(mentionContext)) {
      signals.push("moderate_positive");
      rawScore += 0.25;
      break;
    }
  }

  // Apply speaker role multiplier
  const roleMultiplier = speakerRole
    ? (SPEAKER_ROLE_MULTIPLIERS[speakerRole.toLowerCase()] ?? 1.0)
    : 1.0;

  if (speakerRole) {
    signals.push(`speaker_role:${speakerRole}`);
  }

  // Normalize score to 0-1
  const score = Math.min(rawScore * roleMultiplier, 1.0);

  // Determine verdict
  let verdict: RecommendationVerdict;
  if (hasSponsorRead) {
    verdict = "sponsor_read";
  } else if (score >= 0.7) {
    verdict = "strong_endorsement";
  } else if (score > 0) {
    verdict = "casual_mention";
  } else {
    verdict = "casual_mention";
  }

  return { score, signals, verdict };
}
