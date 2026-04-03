/**
 * Podcast Commerce Intelligence MCP Server
 *
 * Four tools for the agent-to-agent economy:
 *   extract_podcast_products    — Extract products/brands from a transcript
 *   analyze_episode_sponsors    — Identify sponsor segments and read-through estimates
 *   track_product_trends        — Compare product mentions across multiple episodes
 *   compare_products_across_shows — Cross-show product ranking with entity resolution
 *
 * Payment: 5 free calls/day per agent, then API key required ($0.001/call).
 * Transport: stdio only (v0).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { getCache, FREE_TIER_DAILY_LIMIT } from "./cache.js";
import {
  extractProducts,
  buildSponsorAnalysis,
  computeTrends,
  compareProductsAcrossShows,
} from "./extractor.js";
import type { ExtractionResult, AuthResult } from "./types.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const SERVER_NAME = "podcast-commerce-intelligence";
const SERVER_VERSION = "0.1.0";
const TOOL_PRICE_USD = 0.001;

// Input size limits (FIND-4 — prevent oversized payloads reaching OpenAI)
export const TRANSCRIPT_MAX_CHARS = 100_000; // ~50k words, covers any real episode
export const ID_MAX_CHARS = 200;
export const API_KEY_MAX_CHARS = 200;
export const CATEGORY_FILTER_ITEM_MAX = 50;
export const CATEGORY_FILTER_ARRAY_MAX = 20;
export const EPISODE_IDS_ARRAY_MAX = 20;

// ============================================================================
// AUTH
// ============================================================================

/**
 * Get the effective agent ID.
 * Uses AGENT_ID env var, falls back to a deterministic anonymous ID.
 */
function getAgentId(): string {
  return process.env["AGENT_ID"] ?? "anonymous";
}

/**
 * Parse accepted API keys from MCP_API_KEYS env var (comma-separated).
 */
function getApiKeys(): Set<string> {
  const raw = process.env["MCP_API_KEYS"] ?? "";
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return new Set(keys);
}

/**
 * Check authorization. Order:
 * 1. Payments disabled (PAYMENT_ENABLED != "true") -> always authorized
 * 2. API key -> authorized
 * 3. Free tier quota -> authorized if remaining
 * 4. Deny
 */
function authorize(agentId: string, apiKey?: string): AuthResult {
  const paymentEnabled = process.env["PAYMENT_ENABLED"] === "true";

  if (!paymentEnabled) {
    return { authorized: true, method: "disabled" };
  }

  // API key check
  if (apiKey) {
    const keys = getApiKeys();
    if (keys.has(apiKey)) {
      return { authorized: true, method: "api_key" };
    }
  }

  // Free tier check
  const cache = getCache();
  if (cache.checkFreeTier(agentId)) {
    return { authorized: true, method: "free_tier" };
  }

  const used = cache.getFreeTierUsed(agentId);
  return {
    authorized: false,
    reason: `Free tier exhausted (${used}/${FREE_TIER_DAILY_LIMIT} calls used today). Set MCP_API_KEYS to continue.`,
  };
}

// ============================================================================
// ERROR HELPERS
// ============================================================================

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function paymentRequiredResult(reason: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "payment_required",
          message: reason,
          price_usd: TOOL_PRICE_USD,
          free_tier_limit: FREE_TIER_DAILY_LIMIT,
        }),
      },
    ],
    isError: true,
  };
}

// ============================================================================
// SERVER SETUP
// ============================================================================

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // --------------------------------------------------------------------------
  // TOOL 1: extract_podcast_products
  // --------------------------------------------------------------------------

  server.tool(
    "extract_podcast_products",
    "Extract affiliate products, sponsored brands, and host recommendations from a podcast transcript (text input only — does not process audio or video). Returns product name, category, confidence score, recommendation strength, and sponsor flag. Call this before analyze_episode_sponsors or track_product_trends — both tools reuse its cache. Use for podcast monetization, affiliate program discovery, and episode-to-episode trend tracking. Returns empty products array (not an error) when no product mentions are found. Example: episode_id='huberman-ep-301', category_filter=['physical_goods','supplement'].",
    {
      transcript: z
        .string()
        .min(1)
        .max(TRANSCRIPT_MAX_CHARS)
        .describe("Raw transcript text or a YouTube URL (e.g. https://youtube.com/watch?v=VIDEO_ID) — YouTube transcription uses auto-generated captions; pass plain text for reliable results"),
      episode_id: z
        .string()
        .max(ID_MAX_CHARS)
        .optional()
        .describe("Optional episode identifier for caching and trend tracking"),
      category_filter: z
        .array(z.string().max(CATEGORY_FILTER_ITEM_MAX))
        .max(CATEGORY_FILTER_ARRAY_MAX)
        .optional()
        .describe(
          "Optional list of categories to include: physical_goods, saas, course, book, service, affiliate, other"
        ),
      api_key: z
        .string()
        .max(API_KEY_MAX_CHARS)
        .optional()
        .describe("Optional API key for paid access beyond the free tier"),
    },
    async ({ transcript, episode_id, category_filter, api_key }) => {
      const start = Date.now();
      const agentId = getAgentId();
      const episodeId = episode_id ?? randomUUID();

      // Auth
      const auth = authorize(agentId, api_key);
      if (!auth.authorized) {
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

      try {
        const cache = getCache();

        // Cache check — only if episode_id was provided
        if (episode_id) {
          const cached = cache.get(episodeId);
          if (cached) {
            cached._meta.cache_hit = true;
            cached._meta.processing_time_ms = Date.now() - start;
            return {
              content: [{ type: "text", text: JSON.stringify(cached) }],
            };
          }
        }

        // Extract
        const extracted = await extractProducts({
          transcript,
          episodeId,
          categoryFilter: category_filter,
        });

        const processingTime = Date.now() - start;

        const result: ExtractionResult = {
          ...extracted,
          _meta: {
            processing_time_ms: processingTime,
            ai_cost_usd: extracted.ai_cost_usd,
            cache_hit: false,
          },
        };

        // Cache if episode_id provided
        if (episode_id) {
          cache.set(episodeId, result);
        }

        // Record usage
        cache.recordUsage({
          agentId,
          toolName: "extract_podcast_products",
          paymentMethod: auth.method ?? "disabled",
          amountUsd: auth.method === "api_key" ? TOOL_PRICE_USD : 0,
          success: true,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (err) {
        const cache = getCache();
        cache.recordUsage({
          agentId,
          toolName: "extract_podcast_products",
          paymentMethod: auth.method ?? "disabled",
          amountUsd: 0,
          success: false,
        });
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Extraction failed: ${message}`);
      }
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 2: analyze_episode_sponsors
  // --------------------------------------------------------------------------

  server.tool(
    "analyze_episode_sponsors",
    "Identify and score podcast sponsor segments (host-read ads, mid-roll, pre-roll). Returns sponsor name, ad placement type, call-to-action URL, estimated read-through rate, and revenue metrics based on category benchmarks — not live ad-platform data. Use for advertising intelligence, CPM estimation, and sponsor outreach research. Use this tool when you need sponsor metrics only; for the full product and recommendation list use extract_podcast_products instead. Reuses cached extraction when episode_id matches a prior extract_podcast_products call. Example: episode_id='huberman-ep-301' → returns [{sponsor:'Athletic Greens', placement:'pre-roll', estimated_cpm:25, read_through_rate:0.72}].",
    {
      transcript: z
        .string()
        .min(1)
        .max(TRANSCRIPT_MAX_CHARS)
        .describe("Raw transcript text or a YouTube URL (e.g. https://youtube.com/watch?v=VIDEO_ID) — YouTube transcription uses auto-generated captions; pass plain text for reliable results"),
      episode_id: z
        .string()
        .max(ID_MAX_CHARS)
        .optional()
        .describe("Optional episode identifier — uses cached extraction if available"),
      api_key: z
        .string()
        .max(API_KEY_MAX_CHARS)
        .optional()
        .describe("Optional API key for paid access beyond the free tier"),
    },
    async ({ transcript, episode_id, api_key }) => {
      const start = Date.now();
      const agentId = getAgentId();
      const episodeId = episode_id ?? randomUUID();

      // Auth
      const auth = authorize(agentId, api_key);
      if (!auth.authorized) {
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

      try {
        const cache = getCache();

        // Try to use cached extraction
        let extraction: ExtractionResult | null = episode_id
          ? cache.get(episodeId)
          : null;

        let fromCache = false;

        if (!extraction) {
          const extracted = await extractProducts({ transcript, episodeId });
          const processingTime = Date.now() - start;
          extraction = {
            ...extracted,
            _meta: {
              processing_time_ms: processingTime,
              ai_cost_usd: extracted.ai_cost_usd,
              cache_hit: false,
            },
          };
          if (episode_id) {
            cache.set(episodeId, extraction);
          }
        } else {
          fromCache = true;
        }

        const analysis = buildSponsorAnalysis(extraction);
        analysis._meta = {
          ...analysis._meta,
          processing_time_ms: Date.now() - start,
          cache_hit: fromCache,
        };

        cache.recordUsage({
          agentId,
          toolName: "analyze_episode_sponsors",
          paymentMethod: auth.method ?? "disabled",
          amountUsd: auth.method === "api_key" ? TOOL_PRICE_USD : 0,
          success: true,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(analysis) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Sponsor analysis failed: ${message}`);
      }
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 3: track_product_trends
  // --------------------------------------------------------------------------

  server.tool(
    "track_product_trends",
    "Compare affiliate product and brand mention frequency across multiple podcast episodes to detect rising, stable, and declining trends. Returns trend velocity, mention count per episode, and category breakdown. No AI call — computed from cached extraction data only. Use for affiliate marketing optimization, seasonal product tracking, and content calendar planning. Requires prior extract_podcast_products call for each episode_id — returns an error listing missing IDs if any are not in cache. Example: episode_ids=['ep-301','ep-302','ep-303'].",
    {
      episode_ids: z
        .array(z.string().max(ID_MAX_CHARS))
        .min(1)
        .max(EPISODE_IDS_ARRAY_MAX)
        .describe(
          "List of episode IDs to analyze. Each must have been previously extracted via extract_podcast_products."
        ),
      category_filter: z
        .array(z.string().max(CATEGORY_FILTER_ITEM_MAX))
        .max(CATEGORY_FILTER_ARRAY_MAX)
        .optional()
        .describe("Optional category filter to narrow trend analysis"),
      api_key: z
        .string()
        .max(API_KEY_MAX_CHARS)
        .optional()
        .describe("Optional API key for paid access beyond the free tier"),
    },
    async ({ episode_ids, category_filter, api_key }) => {
      const start = Date.now();
      const agentId = getAgentId();

      // Auth
      const auth = authorize(agentId, api_key);
      if (!auth.authorized) {
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

      try {
        const cache = getCache();

        // Load extractions from cache
        const extractions: ExtractionResult[] = [];
        const missing: string[] = [];

        for (const id of episode_ids) {
          const cached = cache.get(id);
          if (cached) {
            extractions.push(cached);
          } else {
            missing.push(id);
          }
        }

        if (missing.length > 0) {
          return errorResult(
            `Missing cached extractions for episodes: ${missing.join(", ")}. ` +
            `Run extract_podcast_products first for each episode.`
          );
        }

        // Apply category filter if provided
        let filteredExtractions = extractions;
        if (category_filter && category_filter.length > 0) {
          const filter = new Set(category_filter);
          filteredExtractions = extractions.map((e) => ({
            ...e,
            products: e.products.filter((p) => filter.has(p.category)),
          }));
        }

        const report = computeTrends(filteredExtractions);
        report._meta = {
          processing_time_ms: Date.now() - start,
          ai_cost_usd: 0, // trends are computed locally, no OpenAI call
          cache_hit: true,
        };

        cache.recordUsage({
          agentId,
          toolName: "track_product_trends",
          paymentMethod: auth.method ?? "disabled",
          amountUsd: 0,
          success: true,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(report) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Trend analysis failed: ${message}`);
      }
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 4: compare_products_across_shows
  // --------------------------------------------------------------------------

  server.tool(
    "compare_products_across_shows",
    "Compare and rank product mentions across multiple podcast shows using cached extractions — no re-run or extra AI cost. Collapses a 3-call manual join into 1 tool call with entity resolution to match the same product across different show mentions. Returns ranked products with per-show context, average confidence, recommendation consensus, and brand aggregation. Use for multi-show affiliate research, 'best of' page generation, and cross-show brand ranking. Requires prior extract_podcast_products call for each show_id — returns error listing missing IDs if any are absent. Example: show_ids=['epic-gardening','garden-answer'], min_confidence=0.85.",
    {
      show_ids: z
        .array(z.string().max(ID_MAX_CHARS))
        .min(1)
        .max(EPISODE_IDS_ARRAY_MAX)
        .describe(
          "List of show/episode IDs to compare. Each must have a prior extract_podcast_products cache entry."
        ),
      category: z
        .string()
        .max(CATEGORY_FILTER_ITEM_MAX)
        .optional()
        .describe(
          "Optional single-category filter: physical_goods, saas, course, service, supplement, media, event, other"
        ),
      min_confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum confidence threshold (default 0.85). Lower to include more products."),
      min_show_count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe(
          "Minimum number of shows a product must appear in to be included (default 2). Set to 1 for single-show results."
        ),
      api_key: z
        .string()
        .max(API_KEY_MAX_CHARS)
        .optional()
        .describe("Optional API key for paid access beyond the free tier"),
    },
    async ({ show_ids, category, min_confidence, min_show_count, api_key }) => {
      const start = Date.now();
      const agentId = getAgentId();

      const auth = authorize(agentId, api_key);
      if (!auth.authorized) {
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

      try {
        const cache = getCache();
        const extractions: ExtractionResult[] = [];
        const missing: string[] = [];

        for (const id of show_ids) {
          const cached = cache.get(id);
          if (cached) extractions.push(cached);
          else missing.push(id);
        }

        if (missing.length > 0) {
          return errorResult(
            `Missing cached extractions for shows: ${missing.join(", ")}. ` +
              `Run extract_podcast_products first for each show_id.`
          );
        }

        const report = compareProductsAcrossShows({
          extractions,
          category,
          minConfidence: min_confidence,
          minShowCount: min_show_count,
        });
        report._meta = {
          processing_time_ms: Date.now() - start,
          ai_cost_usd: 0,
          cache_hit: true,
        };

        cache.recordUsage({
          agentId,
          toolName: "compare_products_across_shows",
          paymentMethod: auth.method ?? "disabled",
          amountUsd: 0,
          success: true,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(report) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Cross-show comparison failed: ${message}`);
      }
    }
  );

  return server;
}

// ============================================================================
// TRANSPORT
// ============================================================================

export async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes
}
