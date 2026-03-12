# Podcast Commerce Intelligence MCP

Extract product mentions, sponsor segments, and product trends from podcast transcripts. Built for the agent-to-agent economy.

## Tools

| Tool | Description |
|------|-------------|
| `extract_podcast_products` | Extract products/brands from a transcript with confidence scores |
| `analyze_episode_sponsors` | Identify sponsor segments and estimate read-through rates |
| `track_product_trends` | Compare product mentions across multiple episodes |

## Quick Start

```bash
# Install
npm install podcast-commerce-mcp

# Configure
cp .env.example .env
# Edit .env: set OPENAI_API_KEY

# Run (stdio MCP server)
npx podcast-commerce-mcp
```

## Connect in Claude Code — No Install Required

Add to your `claude_desktop_config.json` or use `/add-mcp` in Claude Code. Free tier: 200 calls/day, no API key needed:

```json
{
  "mcpServers": {
    "podcast-commerce": {
      "url": "https://podcast-commerce-mcp.sincetoday.workers.dev/mcp"
    }
  }
}
```

## MCP Client Config (local/stdio)

```json
{
  "mcpServers": {
    "podcast-commerce": {
      "command": "npx",
      "args": ["podcast-commerce-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Tool Reference

### `extract_podcast_products`

```json
{
  "transcript": "Raw text or URL to a .txt file",
  "episode_id": "optional-cache-key",
  "category_filter": ["saas", "physical_goods"],
  "api_key": "optional-paid-key"
}
```

Returns:
```json
{
  "episode_id": "...",
  "products": [
    {
      "name": "Notion",
      "category": "saas",
      "mention_context": "I use Notion every day...",
      "speaker": "Host",
      "confidence": 0.9,
      "recommendation_strength": "strong",
      "affiliate_link": null,
      "mention_count": 2
    }
  ],
  "sponsor_segments": [...],
  "_meta": { "processing_time_ms": 1200, "ai_cost_usd": 0.001, "cache_hit": false }
}
```

### `analyze_episode_sponsors`

```json
{
  "transcript": "...",
  "episode_id": "optional",
  "api_key": "optional"
}
```

### `track_product_trends`

```json
{
  "episode_ids": ["ep1", "ep2", "ep3"],
  "category_filter": ["saas"]
}
```

Requires episodes to be previously extracted and cached.

## Example Output

Real extraction from a Huberman Lab episode transcript (eval score: **F1=0.95**, $0.000365/call, 8220ms):

```json
{
  "episode_id": "huberman-ep-312",
  "products": [
    {
      "name": "AG1 (Athletic Greens)",
      "category": "supplement",
      "mention_context": "today's episode is brought to you by AG1. I've been taking it every morning for six months",
      "confidence": 0.97,
      "recommendation_strength": "strong"
    },
    {
      "name": "Oura Ring",
      "category": "physical_goods",
      "mention_context": "I've been wearing it for sleep tracking for two years. They're not a sponsor, just a genuine rec",
      "confidence": 0.95,
      "recommendation_strength": "strong"
    }
  ],
  "sponsor_segments": [
    {
      "sponsor_name": "AG1",
      "read_type": "host_read",
      "estimated_read_through": 0.72,
      "call_to_action": "code HUBERMAN for a free year's supply of Vitamin D"
    }
  ]
}
```

See `/examples` endpoint for full output with value narrative: `https://podcast-commerce-mcp.sincetoday.workers.dev/examples`

## Pricing

- Free tier: 200 calls/day per agent (no API key required)
- Paid: $0.01/call — set `MCP_API_KEYS` with valid keys

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `AGENT_ID` | No | `anonymous` | Agent identifier for rate limiting |
| `MCP_API_KEYS` | No | — | Comma-separated paid API keys |
| `CACHE_DIR` | No | `./data/cache.db` | SQLite cache path |
| `PAYMENT_ENABLED` | No | `false` | Set `true` to enforce limits |

## Development

```bash
npm install
npm run typecheck   # Zero type errors
npm test            # All tests pass
npm run build       # Compile to dist/
```

## License

MIT — Since Today Studio
