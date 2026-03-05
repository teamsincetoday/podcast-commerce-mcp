/**
 * Product Extractor — pattern-matching based product mention extraction.
 *
 * Uses pure TypeScript pattern matching (no external AI API required).
 * This makes extraction fast, deterministic, and testable.
 *
 * Strategy:
 * 1. Split transcript into overlapping segments
 * 2. Look for product signal patterns in each segment
 * 3. Extract product-shaped nouns near signal words
 * 4. Score confidence based on signal density
 * 5. Return deduplicated ProductMention[]
 */

import type { ProductMention, ProductCategory } from "./types.js";
import { attributeSpeaker } from "./speaker-attribution.js";
import { scoreRecommendation } from "./sentiment-scorer.js";

// ============================================================================
// SIGNAL PATTERNS
// ============================================================================

interface CategorySignals {
  keywords: RegExp[];
  urlPatterns?: RegExp[];
}

const CATEGORY_SIGNALS: Record<ProductCategory, CategorySignals> = {
  saas: {
    keywords: [
      /\b(app|software|platform|tool|dashboard|subscription|saas|api|integration|plugin|extension|chrome extension|add-?on)\b/i,
      /\b(notion|airtable|zapier|hubspot|salesforce|slack|figma|linear|github|gitlab|vercel|netlify)\b/i,
    ],
    urlPatterns: [/\b\w+\.io\b/i, /\b\w+\.app\b/i],
  },
  books: {
    keywords: [
      /\b(book|read|reading|author|written by|isbn|audiobook|kindle|ebook|chapter|bestseller|novel|memoir)\b/i,
    ],
  },
  courses: {
    keywords: [
      /\b(course|training|bootcamp|certification|udemy|coursera|skillshare|masterclass|workshop|cohort|program|curriculum|lesson|module)\b/i,
    ],
  },
  tools: {
    keywords: [
      /\b(tool|gadget|device|hardware|equipment|gear|kit|setup|rig|workstation|keyboard|monitor|headset|mic|microphone|webcam|camera)\b/i,
    ],
  },
  physical_goods: {
    keywords: [
      /\b(buy|bought|purchase|product|brand|shipped|delivery|amazon|store|shop|order|ordered|package|unboxing|review|rating)\b/i,
    ],
  },
  affiliate: {
    keywords: [
      /\b(link in (the )?bio|use (my )?code|discount code|promo code|affiliate|referral|sponsored|partner|deal|offer|coupon)\b/i,
    ],
  },
  unknown: {
    keywords: [],
  },
};

// Generic product signal words (product-shaped noun indicators)
const PRODUCT_INDICATORS = [
  /\b(use|using|used|love|loved|tried|recommend|recommends|recommended|mention|mentions|mentioned|promote|promotes|check out|checkout|try|tried|switch|switched|started using|been using|rely on|depends on|helped me|changed my|saved me)\b/i,
];

// Patterns to extract product names (capitalized proper nouns near signal words)
const PRODUCT_NAME_PATTERNS = [
  // Capitalized word(s) that look like a brand/product name
  /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\b/g,
  // Quoted product mentions
  /"([^"]{2,40})"/g,
  // App/tool name patterns (e.g., "the Notion app", "a tool called Linear")
  /(?:called|named|use|using|try|love|recommend)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/gi,
];

// Common words to filter out (not product names)
const STOP_WORDS = new Set([
  "I", "You", "We", "They", "He", "She", "It", "This", "That", "These",
  "Those", "The", "A", "An", "And", "Or", "But", "So", "For", "In", "On",
  "At", "To", "Of", "With", "By", "From", "Up", "About", "Into", "Through",
  "During", "Before", "After", "Above", "Below", "Between", "Out", "Off",
  "Over", "Under", "Again", "Further", "Then", "Once", "My", "Your", "Our",
  "Their", "Its", "Who", "What", "When", "Where", "Why", "How", "All", "Both",
  "Each", "Few", "More", "Most", "Other", "Some", "Such", "No", "Nor", "Not",
  "Only", "Own", "Same", "Than", "Too", "Very", "Just", "Because", "While",
  "If", "As", "Until", "Although", "Will", "Would", "Could", "Should",
  "May", "Might", "Shall", "Can", "Need", "Do", "Did", "Has", "Have", "Had",
  "Is", "Are", "Was", "Were", "Be", "Been", "Being", "Get", "Got", "Let",
  "Like", "Look", "Make", "Put", "Take", "Come", "Go", "Know", "Think",
  "See", "Say", "Tell", "Give", "Ask", "Keep", "Work", "Feel", "Try",
  "Call", "Turn", "Start", "Show", "Hear", "Play", "Run", "Move", "Live",
  "Believe", "Hold", "Bring", "Happen", "Write", "Provide", "Sit", "Stand",
  "Lose", "Pay", "Meet", "Include", "Continue", "Set", "Learn", "Change",
  "Lead", "Understand", "Watch", "Follow", "Stop", "Create", "Speak", "Read",
  "Spend", "Grow", "Open", "Walk", "Win", "Offer", "Remember", "Love",
  "Consider", "Appear", "Buy", "Wait", "Serve", "Die", "Send", "Expect",
  "Build", "Stay", "Fall", "Cut", "Reach", "Kill", "Remain", "Suggest",
  "Raise", "Pass", "Sell", "Require", "Report", "Decide", "Pull", "Break",
  "Thank", "Here", "There", "Now", "Then", "Today", "Monday", "Tuesday",
  "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January",
  "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December", "Amazon", "Google", "Apple", "Facebook",
  "Twitter", "YouTube", "Instagram", "LinkedIn", "Reddit", "Microsoft",
  "OK", "Yeah", "Yes", "No", "Well", "Actually", "Really", "Right", "Good",
  "Great", "Things", "Thing", "Time", "Way", "People", "Year", "Years",
  "Day", "Days", "Week", "Weeks", "Month", "Months", "Episode", "Podcast",
  "Show", "Guest", "Host", "Interview", "Question", "Answer", "Point",
  "Today", "Back", "Around", "Next", "New", "Old", "First", "Last",
  "Long", "Little", "Own", "Right", "Big", "High", "Small", "Large",
  "Different", "Public", "Bad", "Same", "Able", "Lot", "Part",
]);

// ============================================================================
// SEGMENT EXTRACTION
// ============================================================================

const SEGMENT_SIZE = 300; // chars
const SEGMENT_OVERLAP = 100; // chars

function splitIntoSegments(text: string): Array<{ text: string; offset: number }> {
  const segments: Array<{ text: string; offset: number }> = [];
  let offset = 0;

  while (offset < text.length) {
    const end = Math.min(offset + SEGMENT_SIZE, text.length);
    segments.push({ text: text.slice(offset, end), offset });
    if (end >= text.length) break;
    offset += SEGMENT_SIZE - SEGMENT_OVERLAP;
  }

  return segments;
}

// ============================================================================
// CATEGORY DETECTION
// ============================================================================

function detectCategory(context: string): ProductCategory {
  const scores: Partial<Record<ProductCategory, number>> = {};

  for (const [category, signals] of Object.entries(CATEGORY_SIGNALS) as Array<[ProductCategory, CategorySignals]>) {
    if (category === "unknown") continue;
    let score = 0;
    for (const pattern of signals.keywords) {
      if (pattern.test(context)) score += 1;
    }
    if (signals.urlPatterns) {
      for (const pattern of signals.urlPatterns) {
        if (pattern.test(context)) score += 0.5;
      }
    }
    if (score > 0) scores[category] = score;
  }

  if (Object.keys(scores).length === 0) return "unknown";

  const best = Object.entries(scores).reduce((a, b) =>
    (b[1] ?? 0) > (a[1] ?? 0) ? b : a
  );
  return best[0] as ProductCategory;
}

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

function scoreConfidence(productName: string, context: string): number {
  let score = 0.3; // base score for any pattern match

  // Boost for being near product indicator words
  for (const pattern of PRODUCT_INDICATORS) {
    if (pattern.test(context)) {
      score += 0.2;
      break;
    }
  }

  // Boost for affiliate signals
  if (CATEGORY_SIGNALS.affiliate.keywords[0]?.test(context)) {
    score += 0.2;
  }

  // Boost for multi-word product names (more specific)
  if (productName.includes(" ")) {
    score += 0.1;
  }

  // Boost for repeated mention in context
  const namePattern = new RegExp(`\\b${productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  const matches = context.match(namePattern);
  if (matches && matches.length > 1) {
    score += 0.1;
  }

  return Math.min(score, 1.0);
}

// ============================================================================
// PRODUCT NAME EXTRACTION
// ============================================================================

function extractCandidateNames(segment: string): string[] {
  const candidates = new Set<string>();

  for (const pattern of PRODUCT_NAME_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(segment)) !== null) {
      const name = (match[1] ?? match[0]).trim();
      if (
        name.length >= 2 &&
        name.length <= 50 &&
        !STOP_WORDS.has(name) &&
        /[A-Za-z]/.test(name)
      ) {
        candidates.add(name);
      }
    }
  }

  return [...candidates];
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

function deduplicateMentions(mentions: ProductMention[]): ProductMention[] {
  const byName = new Map<string, ProductMention>();

  for (const mention of mentions) {
    const key = mention.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || mention.confidence > existing.confidence) {
      byName.set(key, mention);
    }
  }

  return [...byName.values()].sort((a, b) => b.confidence - a.confidence);
}

// ============================================================================
// MAIN EXTRACTION
// ============================================================================

/**
 * Extract product mentions from a podcast transcript using pattern matching.
 *
 * @param transcript - Full transcript text
 * @param categories - Optional filter (only return these categories)
 * @param minConfidence - Minimum confidence threshold (default 0.5)
 * @returns Array of ProductMention sorted by confidence descending
 */
export async function extractProducts(
  transcript: string,
  categories?: string[],
  minConfidence = 0.5,
): Promise<ProductMention[]> {
  const segments = splitIntoSegments(transcript);
  const rawMentions: ProductMention[] = [];

  for (const segment of segments) {
    const { text: segText } = segment;

    // Check if segment has any product signals
    let hasSignal = false;
    for (const pattern of PRODUCT_INDICATORS) {
      if (pattern.test(segText)) {
        hasSignal = true;
        break;
      }
    }
    if (!hasSignal) {
      // Also check category-specific signals
      for (const signals of Object.values(CATEGORY_SIGNALS)) {
        for (const kw of signals.keywords) {
          if (kw.test(segText)) {
            hasSignal = true;
            break;
          }
        }
        if (hasSignal) break;
      }
    }
    if (!hasSignal) continue;

    const candidates = extractCandidateNames(segText);

    for (const name of candidates) {
      const category = detectCategory(segText);
      const confidence = scoreConfidence(name, segText);

      if (confidence < minConfidence) continue;
      if (categories && categories.length > 0 && !categories.includes(category)) continue;

      const scoring = scoreRecommendation(segText, undefined, name);
      const speaker = attributeSpeaker(segText, transcript);

      const mention: ProductMention = {
        name,
        category,
        mention_context: segText.slice(0, 100),
        speaker,
        confidence,
        recommendation_strength: scoring.score,
      };

      // Check for affiliate link hint
      if (CATEGORY_SIGNALS.affiliate.keywords[0]?.test(segText)) {
        const linkMatch = segText.match(/https?:\/\/\S+/);
        if (linkMatch) {
          mention.affiliate_link = linkMatch[0];
        }
      }

      rawMentions.push(mention);
    }
  }

  return deduplicateMentions(rawMentions);
}
