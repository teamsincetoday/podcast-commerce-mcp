# `extract_podcast_products` — Example Output

Extract product and brand mentions from a podcast transcript. Returns structured data: product name, category, confidence score, recommendation strength, and sponsor segments. Cached by `episode_id` so downstream tools don't re-process.

## Example Call

```json
{
  "tool": "extract_podcast_products",
  "arguments": {
    "transcript": "...today's episode is brought to you by AG1. I've been taking it every morning for six months now and honestly I feel great. Use code HUBERMAN for a free year's supply of Vitamin D... We also talked about Momentous supplements — their omega-3 is the only one I trust, cold-pressed, no fishy aftertaste. And I want to mention the Oura Ring. I've been wearing it for sleep tracking for two years. They're not a sponsor, just a genuine rec...",
    "episode_id": "huberman-ep-312"
  }
}
```

## Example Output

```json
{
  "episode_id": "huberman-ep-312",
  "products": [
    {
      "name": "AG1 (Athletic Greens)",
      "category": "supplement",
      "mention_context": "today's episode is brought to you by AG1. I've been taking it every morning for six months",
      "speaker": null,
      "confidence": 0.97,
      "recommendation_strength": "strong",
      "affiliate_link": null,
      "mention_count": 2
    },
    {
      "name": "Momentous Omega-3",
      "category": "supplement",
      "mention_context": "their omega-3 is the only one I trust, cold-pressed, no fishy aftertaste",
      "speaker": null,
      "confidence": 0.91,
      "recommendation_strength": "strong",
      "affiliate_link": null,
      "mention_count": 1
    },
    {
      "name": "Oura Ring",
      "category": "physical_goods",
      "mention_context": "I've been wearing it for sleep tracking for two years. They're not a sponsor, just a genuine rec",
      "speaker": null,
      "confidence": 0.95,
      "recommendation_strength": "strong",
      "affiliate_link": null,
      "mention_count": 1
    }
  ],
  "sponsor_segments": [
    {
      "sponsor_name": "AG1",
      "segment_start_context": "today's episode is brought to you by AG1",
      "read_type": "host_read",
      "estimated_read_through": 0.72,
      "call_to_action": "code HUBERMAN for a free year's supply of Vitamin D"
    }
  ],
  "_meta": {
    "processing_time_ms": 1840,
    "ai_cost_usd": 0.0031,
    "cache_hit": false
  }
}
```

## What to do with this

- **`recommendation_strength: "strong"` on Oura Ring + `is_sponsored: false` equivalent** — organic endorsement from a trusted host is higher-converting than a sponsor read. Find the Oura affiliate program and place it in show notes immediately.
- **AG1 `estimated_read_through: 0.72`** — 72% read-through rate. Host-read mid-show performs significantly better than pre-roll (typically 0.35–0.45). AG1 and Athletic Greens have affiliate programs; even if the show already has a sponsor deal, you can benchmark your own shows against this.
- **`confidence: 0.91` on Momentous** — high confidence, strong rec, no affiliate link captured. This is a gap: find the Momentous affiliate program and suggest it to the host as an upgrade to organic mentions.
- Run `analyze_episode_sponsors` with `episode_id: "huberman-ep-312"` to get CPM estimates and sponsor-fit scoring without re-processing the transcript.
