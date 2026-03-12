/**
 * Show Notes Formatter
 *
 * Converts extracted ProductMention[] into a formatted shoppable show notes section.
 * Supports markdown and HTML, minimal and full styles.
 * affiliate_link may be null — rendered as plain name or placeholder until ChatAds resolves it.
 */

import type { ProductMention } from "./types.js";

export type ShowNotesFormat = "markdown" | "html";
export type ShowNotesStyle = "minimal" | "full";

const STRENGTH_ORDER: Record<string, number> = {
  strong: 0,
  moderate: 1,
  mention: 2,
  negative: 3,
};

const STRENGTH_EMOJI: Record<string, string> = {
  strong: "⭐",
  moderate: "👍",
  mention: "📍",
};

const STRENGTH_LABEL: Record<string, string> = {
  strong: "Strong Endorsements",
  moderate: "Recommendations",
  mention: "Also Mentioned",
};

function formatProductLink(product: ProductMention, format: ShowNotesFormat): string {
  const name = product.name;
  const link = product.affiliate_link;
  if (format === "html") {
    return link ? `<a href="${link}">${name}</a>` : `<span>${name}</span>`;
  }
  return link ? `[${name}](${link})` : `**${name}**`;
}

/**
 * Generate a shoppable show notes section from extracted products.
 * @param products - ProductMention array from extract_podcast_products
 * @param format - "markdown" (default) or "html"
 * @param style - "minimal" (name + category) or "full" (grouped by endorsement strength, with context)
 */
export function generateShowNotes(
  products: ProductMention[],
  format: ShowNotesFormat,
  style: ShowNotesStyle,
): string {
  const significant = products
    .filter((p) => p.recommendation_strength !== "negative" && p.confidence >= 0.6)
    .sort((a, b) => {
      const sa = STRENGTH_ORDER[a.recommendation_strength] ?? 4;
      const sb = STRENGTH_ORDER[b.recommendation_strength] ?? 4;
      return sa !== sb ? sa - sb : b.confidence - a.confidence;
    });

  if (significant.length === 0) {
    return format === "html"
      ? "<p><em>No significant product mentions found in this episode.</em></p>"
      : "_No significant product mentions found in this episode._";
  }

  return style === "minimal"
    ? generateMinimal(significant, format)
    : generateFull(significant, format);
}

function generateMinimal(products: ProductMention[], format: ShowNotesFormat): string {
  if (format === "html") {
    const items = products
      .map(
        (p) =>
          `  <li>${formatProductLink(p, format)} <span class="category">${p.category.replace(/_/g, " ")}</span></li>`,
      )
      .join("\n");
    return `<h2>Mentioned Products</h2>\n<ul>\n${items}\n</ul>`;
  }
  const items = products
    .map((p) => `- ${formatProductLink(p, format)} — ${p.category.replace(/_/g, " ")}`)
    .join("\n");
  return `## Mentioned Products\n\n${items}`;
}

function generateFull(products: ProductMention[], format: ShowNotesFormat): string {
  const groups: Record<string, ProductMention[]> = {};
  for (const p of products) {
    const key = p.recommendation_strength;
    if (key === "negative") continue;
    (groups[key] = groups[key] ?? []).push(p);
  }

  const cta = "Affiliate links support the creator — thank you for using them.";

  if (format === "html") {
    const sections = Object.entries(groups).map(([strength, prods]) => {
      const label = STRENGTH_LABEL[strength] ?? strength;
      const emoji = STRENGTH_EMOJI[strength] ?? "";
      const items = prods
        .map((p) => {
          const link = formatProductLink(p, format);
          const ctx = p.mention_context
            ? ` — <em>${p.mention_context.slice(0, 100)}</em>`
            : "";
          return `    <li>${link}${ctx}</li>`;
        })
        .join("\n");
      return `  <h3>${emoji} ${label}</h3>\n  <ul>\n${items}\n  </ul>`;
    });
    return [
      "<h2>Products Mentioned in This Episode</h2>",
      ...sections,
      `<p><em>${cta}</em></p>`,
    ].join("\n");
  }

  const sections = Object.entries(groups).map(([strength, prods]) => {
    const label = STRENGTH_LABEL[strength] ?? strength;
    const emoji = STRENGTH_EMOJI[strength] ?? "";
    const header = `### ${emoji} ${label}`;
    const items = prods
      .map((p) => {
        const link = formatProductLink(p, format);
        const ctx = p.mention_context
          ? `\n  > *"${p.mention_context.slice(0, 100)}"*`
          : "";
        return `- ${link} — ${p.category.replace(/_/g, " ")}${ctx}`;
      })
      .join("\n");
    return `${header}\n\n${items}`;
  });

  return `## Products Mentioned in This Episode\n\n${sections.join("\n\n")}\n\n---\n*${cta}*`;
}
