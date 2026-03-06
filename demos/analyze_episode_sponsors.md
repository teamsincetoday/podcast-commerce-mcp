# `analyze_episode_sponsors` — Example Output

Identify sponsor segments, estimate read-through rates, and score sponsor-listener fit. Accepts a transcript directly or an `episode_id` from a previous `extract_podcast_products` call — no re-processing if already cached.

## Example Call

```json
{
  "tool": "analyze_episode_sponsors",
  "arguments": {
    "episode_id": "huberman-ep-312"
  }
}
```

## Example Output

```json
{
  "sponsors": [
    {
      "sponsor_name": "AG1",
      "segment_start_context": "today's episode is brought to you by AG1",
      "read_type": "host_read",
      "estimated_read_through": 0.72,
      "call_to_action": "code HUBERMAN for a free year's supply of Vitamin D"
    },
    {
      "sponsor_name": "Helix Sleep",
      "segment_start_context": "before we get to the science, a quick word from Helix",
      "read_type": "mid_roll",
      "estimated_read_through": 0.58,
      "call_to_action": "helixsleep.com/huberman for 20% off"
    },
    {
      "sponsor_name": "LMNT",
      "segment_start_context": "and we're back — thanks to LMNT for supporting this episode",
      "read_type": "post_roll",
      "estimated_read_through": 0.31,
      "call_to_action": "drinklmnt.com/hubermanlab for free sample pack"
    }
  ],
  "sponsor_count": 3,
  "avg_read_through": 0.54,
  "_meta": {
    "cache_hit": true,
    "processing_time_ms": 12
  }
}
```

## What to do with this

- **`cache_hit: true` + `processing_time_ms: 12`** — cached from the earlier extraction. No LLM cost for the second call. This is the workflow: extract once, analyze repeatedly.
- **`host_read: 0.72` vs `post_roll: 0.31`** — host reads convert at 2.3× post-roll. If you're monetising your own show, this benchmark tells you mid-show reads are worth commanding a premium for.
- **3 sponsors × avg 0.54 read-through** — saturation is mild. A 4th sponsor slot (pre-roll at ~0.40) would still be above average. Useful as a pitch data point.
- **LMNT at 0.31** — below-average post-roll performance. If this is your show, consider moving the LMNT slot to mid-roll or adding a personal use story to lift engagement.
- Cross-reference `call_to_action` codes with affiliate dashboards to close the loop on actual conversions.
