# `track_product_trends` — Example Output

Compare product mentions across multiple episodes to identify rising, stable, and falling product trends. Requires episodes to have been previously processed and cached via `extract_podcast_products`.

## Example Call

```json
{
  "tool": "track_product_trends",
  "arguments": {
    "episode_ids": [
      "huberman-ep-308",
      "huberman-ep-309",
      "huberman-ep-310",
      "huberman-ep-311",
      "huberman-ep-312"
    ]
  }
}
```

## Example Output

```json
{
  "trends": [
    {
      "name": "AG1 (Athletic Greens)",
      "category": "supplement",
      "trend": "stable",
      "episodes_present": 5,
      "total_mentions": 10
    },
    {
      "name": "Momentous Omega-3",
      "category": "supplement",
      "trend": "rising",
      "episodes_present": 3,
      "total_mentions": 5
    },
    {
      "name": "Oura Ring",
      "category": "physical_goods",
      "trend": "rising",
      "episodes_present": 4,
      "total_mentions": 6
    },
    {
      "name": "Whoop",
      "category": "physical_goods",
      "trend": "falling",
      "episodes_present": 2,
      "total_mentions": 2
    },
    {
      "name": "Huberman Lab Neural Network newsletter",
      "category": "media",
      "trend": "stable",
      "episodes_present": 5,
      "total_mentions": 15
    }
  ],
  "episode_ids": [
    "huberman-ep-308",
    "huberman-ep-309",
    "huberman-ep-310",
    "huberman-ep-311",
    "huberman-ep-312"
  ],
  "analysis_window_episodes": 5,
  "_meta": {
    "processing_time_ms": 38,
    "cache_hit": true
  }
}
```

## What to do with this

- **Momentous + Oura Ring both `trend: "rising"`** — organic mentions increasing. These are the products with the most monetisation upside right now. Prioritise finding or upgrading affiliate arrangements for both.
- **Whoop `trend: "falling"`** — appeared in 2 of 5 episodes and declining. Either the host is switching to Oura (confirmed above), or engagement with wearables as a category is shifting. Watch one more episode window before acting.
- **AG1 `stable` × 5 episodes = consistent placement** — reliable sponsorship product. Good benchmark for estimating baseline CPM on the show.
- **`processing_time_ms: 38`** — all cache hits. Trend analysis across 5 episodes in 38ms because no re-extraction happened. This is the compounding value of caching: extract once, trend-track indefinitely.
- For automated monitoring: set up an agent that calls `track_product_trends` on new episode publish, comparing the latest 8 episodes. Alert when any product crosses "falling" → triggers outreach to find replacement affiliate.
