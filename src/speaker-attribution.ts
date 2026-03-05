/**
 * Speaker Attribution — heuristic speaker detection from transcript context.
 *
 * Uses simple pattern matching to attribute product mentions to speakers.
 * No external API required.
 */

import type { SpeakerRecommendation } from "./types.js";

// ============================================================================
// PATTERNS
// ============================================================================

// Patterns for detecting speaker labels in transcripts
const SPEAKER_LABEL_PATTERN = /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s*:/m;
const HOST_INDICATORS = [
  /\b(today['']s guest|my guest|I['']m your host|welcome to|joining me|interviewed by)\b/i,
];
const GUEST_INDICATORS = [
  /\b(my guest|our guest|joining us|guest today|author of|founder of|CEO of|been on the show)\b/i,
];

// First-person indicators (typically host speaking)
const FIRST_PERSON_PATTERN = /\bI (use|used|love|loved|recommend|tried|bought|purchased|swear by|rely on)\b/i;

// ============================================================================
// SPEAKER ATTRIBUTION
// ============================================================================

/**
 * Attribute a product mention to a speaker.
 *
 * Heuristics (in order):
 * 1. Look for "Name:" speaker label before the mention context
 * 2. Check for guest indicators
 * 3. Check for first-person usage (likely host)
 * 4. Default to "host"
 *
 * @param mentionContext - Text surrounding the product mention
 * @param transcript - Full transcript for broader context
 * @returns Speaker identifier ("host", "guest", or detected name)
 */
export function attributeSpeaker(
  mentionContext: string,
  transcript: string,
): string {
  // Look for a speaker label pattern (e.g., "John:", "Host:") in context
  const labelMatch = mentionContext.match(SPEAKER_LABEL_PATTERN);
  if (labelMatch?.[1]) {
    const label = labelMatch[1].toLowerCase();
    if (label === "host" || label === "interviewer") return "host";
    if (label === "guest" || label === "speaker") return "guest";
    return labelMatch[1]; // Return detected name
  }

  // Check for guest indicators in nearby transcript context
  const transcriptIdx = transcript.indexOf(mentionContext.slice(0, 50));
  if (transcriptIdx >= 0) {
    const windowStart = Math.max(0, transcriptIdx - 300);
    const window = transcript.slice(windowStart, transcriptIdx + mentionContext.length);

    for (const pattern of GUEST_INDICATORS) {
      if (pattern.test(window)) {
        return "guest";
      }
    }
    for (const pattern of HOST_INDICATORS) {
      if (pattern.test(window)) {
        return "host";
      }
    }
  }

  // Check for first-person usage in the mention context
  if (FIRST_PERSON_PATTERN.test(mentionContext)) {
    return "host";
  }

  return "host"; // default
}

// ============================================================================
// AUTHORITY SCORING
// ============================================================================

/**
 * Calculate an authority score for a speaker based on their recommendations.
 *
 * Score factors:
 * - Number of recommendations (more = higher authority signal)
 * - Average recommendation strength
 * - Category diversity (broad knowledge = higher authority)
 *
 * @param recommendations - Array of speaker recommendations
 * @returns Authority score 0-1
 */
export function calculateAuthorityScore(
  recommendations: SpeakerRecommendation[],
): number {
  if (recommendations.length === 0) return 0;

  // Average recommendation strength
  const avgStrength =
    recommendations.reduce((sum, r) => sum + r.recommendation_strength, 0) /
    recommendations.length;

  // Volume factor (more recommendations = more authoritative, diminishing returns)
  const volumeFactor = Math.min(recommendations.length / 20, 1.0);

  // Category diversity factor
  const categories = new Set(recommendations.map((r) => r.category));
  const diversityFactor = Math.min(categories.size / 5, 1.0);

  // Weighted score
  const score = avgStrength * 0.5 + volumeFactor * 0.3 + diversityFactor * 0.2;

  return Math.round(score * 100) / 100;
}
