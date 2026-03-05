/**
 * Podcast Commerce Intelligence MCP Server
 *
 * Three tools for the agent-to-agent economy:
 *   extract_podcast_products  — Extract products/brands from a transcript
 *   analyze_episode_sponsors  — Identify sponsor segments and read-through estimates
 *   track_product_trends      — Compare product mentions across multiple episodes
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
} from "./extractor.js";
import type { ExtractionResult, AuthResult } from "./types.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const SERVER_NAME = "podcast-commerce-intelligence";
const SERVER_VERSION = "0.1.0";
const TOOL_PRICE_USD = 0.001;

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
    "Extract product and brand mentions from a podcast transcript. Returns structured data including product name, category, confidence score, recommendation strength, and sponsor segments. Supports caching by episode_id.",
    {
      transcript: z
        .string()
        .min(1)
        .describe("Raw transcript text OR a URL to a .txt transcript file"),
      episode_id: z
        .string()
        .optional()
        .describe("Optional episode identifier for caching and trend tracking"),
      category_filter: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of categories to include: physical_goods, saas, course, book, service, affiliate, other"
        ),
      api_key: z
        .string()
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
    "Identify sponsor segments in a podcast episode and estimate read-through rates. Returns sponsor list, read type (host-read, mid-roll, etc.), call-to-action, and aggregate metrics. Uses cached extraction if episode_id was previously processed.",
    {
      transcript: z
        .string()
        .min(1)
        .describe("Raw transcript text OR a URL to a .txt transcript file"),
      episode_id: z
        .string()
        .optional()
        .describe("Optional episode identifier — uses cached extraction if available"),
      api_key: z
        .string()
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
    "Compare product mentions across multiple podcast episodes to identify rising, stable, and falling product trends. Requires episodes to have been previously extracted (via extract_podcast_products) and cached by episode_id.",
    {
      episode_ids: z
        .array(z.string())
        .min(1)
        .describe(
          "List of episode IDs to analyze. Each must have been previously extracted via extract_podcast_products."
        ),
      category_filter: z
        .array(z.string())
        .optional()
        .describe("Optional category filter to narrow trend analysis"),
      api_key: z
        .string()
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
