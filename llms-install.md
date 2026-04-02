# Installing podcast-commerce-mcp with Cline

This is a **remote MCP server** running on Cloudflare Workers. No local installation, no npm install, no build step required.

## Quick Setup (Free Tier)

Free tier: **200 calls/day, no API key required.**

Add to your Cline MCP settings (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "podcast-commerce": {
      "url": "https://podcast-commerce-mcp.sincetoday.workers.dev/mcp",
      "type": "streamableHttp",
      "timeout": 60
    }
  }
}
```

Cline → Extensions (⊞) → Remote Servers → paste URL: `https://podcast-commerce-mcp.sincetoday.workers.dev/mcp`

## Paid Tier (optional)

Unlimited calls at $0.01/call. Add `X-API-Key` header with your key:

```json
{
  "mcpServers": {
    "podcast-commerce": {
      "url": "https://podcast-commerce-mcp.sincetoday.workers.dev/mcp",
      "type": "streamableHttp",
      "headers": {
        "X-API-Key": "your-api-key"
      },
      "timeout": 60
    }
  }
}
```

## Available Tools

- **`extract_podcast_products`** — Extract product mentions from podcast transcripts with speaker attribution, sentiment, and confidence scores. Input: transcript text + optional category filter. Output: structured product list with affiliate link slots.
- **`analyze_episode_sponsors`** — Analyze sponsor fit scores and host endorsement relationships for a podcast episode.
- **`compare_products_across_shows`** — Cross-show product trend analysis using cached extractions. Collapses a 3-call manual join into 1 tool call with entity resolution.
- **`generate_show_notes_section`** — Format extracted products into a shoppable show notes block (markdown or HTML), grouped by endorsement strength.

## Verify Connection

After adding the server, ask Cline: *"What tools does podcast-commerce provide?"*

Test with: *"Extract products from this transcript: [paste transcript text]"*

## Specs

- Endpoint: `https://podcast-commerce-mcp.sincetoday.workers.dev/mcp`
- Transport: Streamable HTTP (MCP spec 2025-11-05)
- Auth: None (free tier) or `X-API-Key` header (paid)
- Free tier: 200 calls/day per IP
- Paid tier: $0.01/call (x402 micropayments)
- Tests: 643 passing, F1=100%, OWASP-compliant
- Source: https://github.com/teamsincetoday/podcast-commerce-mcp
