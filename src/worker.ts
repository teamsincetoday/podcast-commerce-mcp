/**
 * Podcast Commerce MCP — Cloudflare Workers Adapter
 *
 * Streamable HTTP transport for remote deployment.
 * Replaces SQLite cache with Workers KV.
 * Auth: API key or free tier (200 calls/day per IP via CF-Connecting-IP).
 *
 * Routes:
 *   GET  /health  — health check
 *   *    /mcp     — MCP Streamable HTTP endpoint (stateless)
 *   OPTIONS *     — CORS preflight
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

import {
  setOpenAIClient,
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

export const FREE_TIER_DAILY_LIMIT = 200;
export const TRANSCRIPT_MAX_CHARS = 100_000;
export const ID_MAX_CHARS = 200;
export const API_KEY_MAX_CHARS = 200;
export const CATEGORY_FILTER_ITEM_MAX = 50;
export const CATEGORY_FILTER_ARRAY_MAX = 20;
export const EPISODE_IDS_ARRAY_MAX = 20;

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const RATE_LIMIT_TTL_SECONDS = 90_000; // 25 hours — covers day boundary

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
};

// ============================================================================
// CLOUDFLARE ENV
// ============================================================================

export interface Env {
  PODCAST_CACHE: KVNamespace;
  RATE_LIMITS: KVNamespace;
  OPENAI_API_KEY: string;
  MCP_API_KEYS?: string;
  PAYMENT_ENABLED?: string;
}

// ============================================================================
// AUTH (KV-backed, IP-based free tier)
// ============================================================================

function getApiKeys(env: Env): Set<string> {
  const raw = env.MCP_API_KEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
  );
}

async function checkFreeTier(kv: KVNamespace, ip: string): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const key = `ratelimit:${ip}:${today}`;
  const raw = await kv.get(key);
  return (raw ? parseInt(raw, 10) : 0) < FREE_TIER_DAILY_LIMIT;
}

async function incrementFreeTier(kv: KVNamespace, ip: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const key = `ratelimit:${ip}:${today}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_TTL_SECONDS });
}

async function authorize(env: Env, request: Request, apiKey?: string): Promise<AuthResult> {
  const paymentEnabled = env.PAYMENT_ENABLED === "true";

  if (!paymentEnabled) {
    return { authorized: true, method: "disabled" };
  }

  if (apiKey) {
    if (getApiKeys(env).has(apiKey)) {
      return { authorized: true, method: "api_key" };
    }
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (await checkFreeTier(env.RATE_LIMITS, ip)) {
    await incrementFreeTier(env.RATE_LIMITS, ip);
    return { authorized: true, method: "free_tier" };
  }

  return {
    authorized: false,
    reason: `Free tier exhausted (${FREE_TIER_DAILY_LIMIT} calls/day per IP). Set api_key param or contact team@sincetoday.com.`,
  };
}

// ============================================================================
// KV CACHE
// ============================================================================

async function cacheGet(kv: KVNamespace, id: string): Promise<ExtractionResult | null> {
  const raw = await kv.get(`podcast:episode:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExtractionResult;
  } catch {
    return null;
  }
}

async function cacheSet(kv: KVNamespace, id: string, data: ExtractionResult): Promise<void> {
  await kv.put(`podcast:episode:${id}`, JSON.stringify(data), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
}

// ============================================================================
// RESPONSE HELPERS
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
// MCP SERVER FACTORY
// ============================================================================

function createMcpServer(env: Env, request: Request): McpServer {
  // Inject OpenAI client with env secret (Workers-safe, no process.env)
  setOpenAIClient(new OpenAI({ apiKey: env.OPENAI_API_KEY }));

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

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
        .max(TRANSCRIPT_MAX_CHARS)
        .describe("Raw transcript text OR a URL to a .txt transcript file"),
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
      const episodeId = episode_id ?? randomUUID();

      const auth = await authorize(env, request, api_key);
      if (!auth.authorized) return paymentRequiredResult(auth.reason ?? "Payment required");

      if (episode_id) {
        const cached = await cacheGet(env.PODCAST_CACHE, episodeId);
        if (cached) {
          cached._meta.cache_hit = true;
          cached._meta.processing_time_ms = Date.now() - start;
          return { content: [{ type: "text", text: JSON.stringify(cached) }] };
        }
      }

      try {
        const extracted = await extractProducts({
          transcript,
          episodeId,
          categoryFilter: category_filter,
        });
        const result: ExtractionResult = {
          ...extracted,
          _meta: {
            processing_time_ms: Date.now() - start,
            ai_cost_usd: extracted.ai_cost_usd,
            cache_hit: false,
          },
        };
        if (episode_id) await cacheSet(env.PODCAST_CACHE, episodeId, result);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
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
        .max(TRANSCRIPT_MAX_CHARS)
        .describe("Raw transcript text OR a URL to a .txt transcript file"),
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
      const episodeId = episode_id ?? randomUUID();

      const auth = await authorize(env, request, api_key);
      if (!auth.authorized) return paymentRequiredResult(auth.reason ?? "Payment required");

      try {
        let extraction = episode_id ? await cacheGet(env.PODCAST_CACHE, episodeId) : null;
        let fromCache = false;

        if (!extraction) {
          const extracted = await extractProducts({ transcript, episodeId });
          extraction = {
            ...extracted,
            _meta: {
              processing_time_ms: Date.now() - start,
              ai_cost_usd: extracted.ai_cost_usd,
              cache_hit: false,
            },
          };
          if (episode_id) await cacheSet(env.PODCAST_CACHE, episodeId, extraction);
        } else {
          fromCache = true;
        }

        const analysis = buildSponsorAnalysis(extraction);
        analysis._meta = {
          ...analysis._meta,
          processing_time_ms: Date.now() - start,
          cache_hit: fromCache,
        };
        return { content: [{ type: "text", text: JSON.stringify(analysis) }] };
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

      const auth = await authorize(env, request, api_key);
      if (!auth.authorized) return paymentRequiredResult(auth.reason ?? "Payment required");

      try {
        const extractions: ExtractionResult[] = [];
        const missing: string[] = [];

        for (const id of episode_ids) {
          const cached = await cacheGet(env.PODCAST_CACHE, id);
          if (cached) extractions.push(cached);
          else missing.push(id);
        }

        if (missing.length > 0) {
          return errorResult(
            `Missing cached extractions for episodes: ${missing.join(", ")}. ` +
              `Run extract_podcast_products first for each episode.`
          );
        }

        let filtered = extractions;
        if (category_filter?.length) {
          const filterSet = new Set(category_filter);
          filtered = extractions.map((e) => ({
            ...e,
            products: e.products.filter((p) => filterSet.has(p.category)),
          }));
        }

        const report = computeTrends(filtered);
        report._meta = {
          processing_time_ms: Date.now() - start,
          ai_cost_usd: 0,
          cache_hit: true,
        };
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Trend analysis failed: ${message}`);
      }
    }
  );

  return server;
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", name: "podcast-commerce-mcp", version: SERVER_VERSION }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // MCP Streamable HTTP endpoint (stateless)
    if (url.pathname === "/mcp" || url.pathname === "/") {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless — no session tracking required
      });

      const server = createMcpServer(env, request);
      await server.connect(transport);

      const response = await transport.handleRequest(request);

      // Merge CORS headers into MCP response
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        headers.set(k, v);
      }
      return new Response(response.body, { status: response.status, headers });
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
