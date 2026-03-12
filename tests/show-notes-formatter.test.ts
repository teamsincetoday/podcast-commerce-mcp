/**
 * Unit tests for show-notes-formatter.ts
 *
 * Pure formatting logic — no mocks or OpenAI calls needed.
 */

import { describe, it, expect } from "vitest";
import { generateShowNotes } from "../src/show-notes-formatter.js";
import type { ProductMention } from "../src/types.js";

const makeProduct = (overrides: Partial<ProductMention>): ProductMention => ({
  name: "Test Product",
  category: "physical_goods",
  mention_context: "Host said this product changed their life",
  speaker: "host",
  confidence: 0.9,
  recommendation_strength: "strong",
  affiliate_link: null,
  mention_count: 1,
  ...overrides,
});

const SAMPLE_PRODUCTS: ProductMention[] = [
  makeProduct({ name: "Athletic Greens AG1", recommendation_strength: "strong", affiliate_link: "https://ag1.com/ref" }),
  makeProduct({ name: "Momentous Protein", recommendation_strength: "moderate", confidence: 0.85 }),
  makeProduct({ name: "Iron Flask Bottle", recommendation_strength: "mention", confidence: 0.7 }),
  makeProduct({ name: "Bad Product", recommendation_strength: "negative", confidence: 0.8 }),
  makeProduct({ name: "Low Confidence", recommendation_strength: "strong", confidence: 0.4 }),
];

describe("generateShowNotes — markdown minimal", () => {
  it("returns a product list with affiliate link when present", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "markdown", "minimal");
    expect(result).toContain("[Athletic Greens AG1](https://ag1.com/ref)");
    expect(result).toContain("## Mentioned Products");
  });

  it("renders products without links as bold name", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "markdown", "minimal");
    expect(result).toContain("**Momentous Protein**");
  });

  it("excludes negative recommendations", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "markdown", "minimal");
    expect(result).not.toContain("Bad Product");
  });

  it("excludes low confidence products (< 0.6)", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "markdown", "minimal");
    expect(result).not.toContain("Low Confidence");
  });
});

describe("generateShowNotes — markdown full", () => {
  it("groups by endorsement strength with headers", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "markdown", "full");
    expect(result).toContain("### ⭐ Strong Endorsements");
    expect(result).toContain("### 👍 Recommendations");
  });

  it("includes mention context quote", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "markdown", "full");
    expect(result).toContain("changed their life");
  });

  it("includes CTA line", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "markdown", "full");
    expect(result).toContain("Affiliate links support the creator");
  });
});

describe("generateShowNotes — html", () => {
  it("returns html tags for minimal format", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "html", "minimal");
    expect(result).toContain("<h2>Mentioned Products</h2>");
    expect(result).toContain("<ul>");
    expect(result).toContain('<a href="https://ag1.com/ref">Athletic Greens AG1</a>');
  });

  it("returns html tags for full format", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "html", "full");
    expect(result).toContain("<h2>Products Mentioned in This Episode</h2>");
    expect(result).toContain("<h3>⭐ Strong Endorsements</h3>");
  });
});

describe("generateShowNotes — empty / edge cases", () => {
  it("handles empty product array gracefully", () => {
    const result = generateShowNotes([], "markdown", "full");
    expect(result).toContain("No significant product mentions");
  });

  it("handles all-negative products gracefully", () => {
    const negativeOnly = [makeProduct({ recommendation_strength: "negative" })];
    const result = generateShowNotes(negativeOnly, "markdown", "full");
    expect(result).toContain("No significant product mentions");
  });

  it("sorts strong endorsements before moderate", () => {
    const result = generateShowNotes(SAMPLE_PRODUCTS, "markdown", "minimal");
    const agIdx = result.indexOf("Athletic Greens AG1");
    const momentousIdx = result.indexOf("Momentous Protein");
    expect(agIdx).toBeLessThan(momentousIdx);
  });
});
