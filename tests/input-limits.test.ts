/**
 * Input size limit tests (FIND-4).
 *
 * Verifies that the Zod schemas in server.ts enforce the expected upper bounds
 * on all user-supplied fields that reach OpenAI. Each test imports the exported
 * limit constants so the assertions stay in sync with the implementation.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  TRANSCRIPT_MAX_CHARS,
  ID_MAX_CHARS,
  API_KEY_MAX_CHARS,
  CATEGORY_FILTER_ITEM_MAX,
  CATEGORY_FILTER_ARRAY_MAX,
  EPISODE_IDS_ARRAY_MAX,
} from "../src/server.js";

// ============================================================================
// transcript (extract_podcast_products, analyze_episode_sponsors)
// ============================================================================

describe("transcript field limits", () => {
  const schema = z.string().min(1).max(TRANSCRIPT_MAX_CHARS);

  it("accepts a transcript at the exact max length", () => {
    expect(schema.safeParse("x".repeat(TRANSCRIPT_MAX_CHARS)).success).toBe(true);
  });

  it("rejects a transcript one character over the limit", () => {
    const result = schema.safeParse("x".repeat(TRANSCRIPT_MAX_CHARS + 1));
    expect(result.success).toBe(false);
  });

  it("rejects an empty transcript", () => {
    expect(schema.safeParse("").success).toBe(false);
  });
});

// ============================================================================
// episode_id / id fields
// ============================================================================

describe("ID field limits", () => {
  const schema = z.string().max(ID_MAX_CHARS).optional();

  it("accepts an ID at the exact max length", () => {
    expect(schema.safeParse("a".repeat(ID_MAX_CHARS)).success).toBe(true);
  });

  it("rejects an ID one character over the limit", () => {
    const result = schema.safeParse("a".repeat(ID_MAX_CHARS + 1));
    expect(result.success).toBe(false);
  });

  it("accepts undefined (optional)", () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });
});

// ============================================================================
// api_key field
// ============================================================================

describe("api_key field limits", () => {
  const schema = z.string().max(API_KEY_MAX_CHARS).optional();

  it("accepts an api_key at the exact max length", () => {
    expect(schema.safeParse("k".repeat(API_KEY_MAX_CHARS)).success).toBe(true);
  });

  it("rejects an api_key one character over the limit", () => {
    const result = schema.safeParse("k".repeat(API_KEY_MAX_CHARS + 1));
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// category_filter array
// ============================================================================

describe("category_filter array limits", () => {
  const schema = z
    .array(z.string().max(CATEGORY_FILTER_ITEM_MAX))
    .max(CATEGORY_FILTER_ARRAY_MAX)
    .optional();

  it("accepts an array at the max item count", () => {
    const input = Array.from({ length: CATEGORY_FILTER_ARRAY_MAX }, (_, i) => `cat${i}`);
    expect(schema.safeParse(input).success).toBe(true);
  });

  it("rejects an array one item over the max count", () => {
    const input = Array.from({ length: CATEGORY_FILTER_ARRAY_MAX + 1 }, (_, i) => `cat${i}`);
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("rejects a category string over the item max length", () => {
    const input = ["c".repeat(CATEGORY_FILTER_ITEM_MAX + 1)];
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("accepts undefined (optional)", () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });
});

// ============================================================================
// episode_ids array (track_product_trends)
// ============================================================================

describe("episode_ids array limits", () => {
  const schema = z
    .array(z.string().max(ID_MAX_CHARS))
    .min(1)
    .max(EPISODE_IDS_ARRAY_MAX);

  it("accepts an array at the max count", () => {
    const input = Array.from({ length: EPISODE_IDS_ARRAY_MAX }, (_, i) => `ep-${i}`);
    expect(schema.safeParse(input).success).toBe(true);
  });

  it("rejects an array one item over the max count", () => {
    const input = Array.from({ length: EPISODE_IDS_ARRAY_MAX + 1 }, (_, i) => `ep-${i}`);
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("rejects an episode ID over the ID max length", () => {
    const input = ["x".repeat(ID_MAX_CHARS + 1)];
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("rejects an empty array (min 1)", () => {
    expect(schema.safeParse([]).success).toBe(false);
  });
});
