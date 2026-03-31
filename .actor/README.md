# Podcast Commerce Extractor

Extract product mentions, brand recommendations, and affiliate opportunities from podcast transcript text. Built on the [podcast-commerce-mcp](https://github.com/teamsincetoday/podcast-commerce-mcp) MCP server.

## What it does

Give it a podcast transcript. Get back a structured list of every product mentioned — with the speaker who mentioned it, how confident the extraction was, and how strongly they recommended it.

**Example output** (from a real gardening podcast):
- "Fiskars Snips" — speaker: host — confidence: 0.94 — recommendation_strength: strong
- "Espoma Organic Fertilizer" — speaker: guest — confidence: 0.87 — recommendation_strength: moderate
- "Gardener's Supply Raised Bed Kit" — speaker: host — confidence: 0.91 — recommendation_strength: strong

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transcript` | String | Yes (if no `url`) | Raw podcast transcript text |
| `url` | String | Yes (if no `transcript`) | URL to fetch transcript from |
| `category_filter` | String | No | Filter by category: `physical`, `saas`, `course`, `affiliate` |
| `min_confidence` | Number | No | Minimum confidence score (0.0–1.0). Default: 0.7 |

## Output

Array of product mentions:

```json
[
  {
    "product_name": "Fiskars Snips",
    "brand": "Fiskars",
    "category": "physical",
    "speaker": "host",
    "mention_context": "I use the Fiskars snips every single episode...",
    "confidence": 0.94,
    "recommendation_strength": "strong",
    "affiliate_link": null
  }
]
```

## Pricing

- **Free**: 200 calls/day — no API key needed
- **Paid**: $0.01/call above the free tier
- Powered by [podcast-commerce-mcp](https://podcast-commerce-mcp.sincetoday.workers.dev)

## Live demo

Try the underlying MCP endpoint: `https://podcast-commerce-mcp.sincetoday.workers.dev/examples`

## Use cases

- Build affiliate show notes automatically after recording
- Find sponsorship opportunities across your back catalog
- Identify which hosts drive the strongest product recommendations
- Feed product data into Airtable/Google Sheets via Apify workflows

## Performance

- F1 accuracy: 100% (live eval on real podcast transcripts)
- Response time: <3s per transcript (avg 4,000 tokens)
- OWASP MCP security compliant

## Related

- [newsletter-commerce-mcp](https://newsletter-commerce-mcp.sincetoday.workers.dev) — same extraction for newsletters
- [recipe-commerce-mcp](https://recipe-commerce-mcp.sincetoday.workers.dev) — ingredients + equipment extraction for recipes
