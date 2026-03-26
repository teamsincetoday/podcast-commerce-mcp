/**
 * Podcast Commerce MCP — Cloudflare Workers Adapter
 *
 * Streamable HTTP transport for remote deployment.
 * Replaces SQLite cache with Workers KV.
 * Auth: API key or free tier (200 calls/day per IP via CF-Connecting-IP).
 *
 * Routes:
 *   GET  /health  — health check
 *   GET  /usage   — traction dashboard (tool call counts, 7-day)
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
  compareProductsAcrossShows,
} from "./extractor.js";
import { CloudflareMetering } from "./metering-cloudflare.js";
import type { ExtractionResult, AuthResult } from "./types.js";
import { generateShowNotes } from "./show-notes-formatter.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const SERVER_NAME = "podcast-commerce-intelligence";
const SERVER_VERSION = "0.1.0";
const TOOL_PRICE_USD = 0.01;
const TOOL_NAMES = ["extract_podcast_products", "analyze_episode_sponsors", "track_product_trends", "compare_products_across_shows", "generate_show_notes_section"] as const;

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
// CLOUDFLARE TYPES
// ============================================================================

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// ============================================================================
// CLOUDFLARE ENV
// ============================================================================

export interface Env {
  PODCAST_CACHE: KVNamespace;
  RATE_LIMITS: KVNamespace;
  TELEMETRY?: KVNamespace;
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
    reason: `Free tier exhausted (${FREE_TIER_DAILY_LIMIT} calls/day per IP). Options: pay per call via x402, set api_key param, or contact team@sincetoday.com for enterprise access.`,
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
  const resetAt = new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString();
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "rate_limit_exceeded",
          message: reason,
          price_usd: TOOL_PRICE_USD,
          free_tier_limit: FREE_TIER_DAILY_LIMIT,
          reset_at: resetAt,
          options: {
            pay_per_call: {
              method: "x402 micropayments",
              price_usd: TOOL_PRICE_USD,
              setup: "Add STABLECOIN_ADDRESS env var — no account needed",
              doc: "https://x402.org",
            },
            api_key: {
              method: "api_key",
              param: "api_key",
              contact: "team@sincetoday.com",
            },
            enterprise: {
              description: "Building at scale? Custom rate limits, white-label endpoints, SLA guarantees, and custom extraction schemas.",
              contact: "team@sincetoday.com",
              subject_line: "Enterprise MCP — [your use case]",
              response_time: "Same business day",
            },
          },
        }),
      },
    ],
    isError: true,
  };
}

// ============================================================================
// MCP SERVER FACTORY
// ============================================================================

/** Map AuthResult payment method to metering method (disabled → free_tier). */
function meteringMethod(method: string | undefined): "api_key" | "free_tier" | "x402" {
  if (method === "api_key") return "api_key";
  if (method === "x402") return "x402";
  return "free_tier";
}

function createMcpServer(env: Env, request: Request, ctx: ExecutionContext): McpServer {
  const metering = env.TELEMETRY ? new CloudflareMetering(env.TELEMETRY) : null;

  // Inject OpenAI client with env secret (Workers-safe, no process.env)
  // 15s timeout: fail fast rather than hanging until CF 30s CPU limit (cold-start UX fix)
  setOpenAIClient(new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 15_000 }));

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
      include_aesthetic_tags: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "When true, includes aestheticTags (warmth/density/origin/tradition) per product. Adds ~20 tokens per product. Default: false.",
        ),
      api_key: z
        .string()
        .max(API_KEY_MAX_CHARS)
        .optional()
        .describe("Optional API key for paid access beyond the free tier"),
    },
    async ({ transcript, episode_id, category_filter, include_aesthetic_tags, api_key }) => {
      const start = Date.now();
      const episodeId = episode_id ?? randomUUID();

      const auth = await authorize(env, request, api_key);
      if (!auth.authorized) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "_auth_failure", paymentMethod: "free_tier", processingTimeMs: 0, success: false }));
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

      if (episode_id) {
        const cached = await cacheGet(env.PODCAST_CACHE, episodeId);
        if (cached) {
          cached._meta.cache_hit = true;
          cached._meta.processing_time_ms = Date.now() - start;
          if (metering) ctx.waitUntil(metering.record({ toolName: "extract_podcast_products", paymentMethod: meteringMethod(auth.method), processingTimeMs: Date.now() - start, success: true }));
          return { content: [{ type: "text", text: JSON.stringify(cached) }] };
        }
      }

      try {
        const extracted = await extractProducts({
          transcript,
          episodeId,
          categoryFilter: category_filter,
          includeAesthetic: include_aesthetic_tags,
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
        if (metering) ctx.waitUntil(metering.record({ toolName: "extract_podcast_products", paymentMethod: meteringMethod(auth.method), amountUsd: auth.method === "api_key" ? TOOL_PRICE_USD : 0, processingTimeMs: Date.now() - start, success: true }));
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "extract_podcast_products", paymentMethod: meteringMethod(auth.method), processingTimeMs: Date.now() - start, success: false }));
        const message = err instanceof OpenAI.APIError
          ? "upstream service temporarily unavailable"
          : (err instanceof Error ? err.message : "internal error");
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
      if (!auth.authorized) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "_auth_failure", paymentMethod: "free_tier", processingTimeMs: 0, success: false }));
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

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
        if (metering) ctx.waitUntil(metering.record({ toolName: "analyze_episode_sponsors", paymentMethod: meteringMethod(auth.method), amountUsd: auth.method === "api_key" ? TOOL_PRICE_USD : 0, processingTimeMs: Date.now() - start, success: true }));
        return { content: [{ type: "text", text: JSON.stringify(analysis) }] };
      } catch (err) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "analyze_episode_sponsors", paymentMethod: meteringMethod(auth.method), processingTimeMs: Date.now() - start, success: false }));
        const message = err instanceof OpenAI.APIError
          ? "upstream service temporarily unavailable"
          : (err instanceof Error ? err.message : "internal error");
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
      if (!auth.authorized) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "_auth_failure", paymentMethod: "free_tier", processingTimeMs: 0, success: false }));
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

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
        if (metering) ctx.waitUntil(metering.record({ toolName: "track_product_trends", paymentMethod: meteringMethod(auth.method), amountUsd: auth.method === "api_key" ? TOOL_PRICE_USD : 0, processingTimeMs: Date.now() - start, success: true }));
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
      } catch (err) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "track_product_trends", paymentMethod: meteringMethod(auth.method), processingTimeMs: Date.now() - start, success: false }));
        const message = err instanceof OpenAI.APIError
          ? "upstream service temporarily unavailable"
          : (err instanceof Error ? err.message : "internal error");
        return errorResult(`Trend analysis failed: ${message}`);
      }
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 4: compare_products_across_shows
  // --------------------------------------------------------------------------

  server.tool(
    "compare_products_across_shows",
    "Compare and rank product mentions across multiple podcast shows using cached extractions — no re-run. Collapses a 3-call manual join into 1 tool call. Performs entity resolution to identify the same product mentioned across shows. Returns ranked cross-show product list with per-show context, average confidence, and recommendation consensus. Use for multi-show affiliate research, best-of page generation, and cross-show brand ranking. Supports physical_goods, saas, supplement, and all other categories. Requires prior extract_podcast_products calls for each show_id.",
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
          "Minimum number of shows a product must appear in (default 2). Set to 1 for single-show results."
        ),
      api_key: z
        .string()
        .max(API_KEY_MAX_CHARS)
        .optional()
        .describe("Optional API key for paid access beyond the free tier"),
    },
    async ({ show_ids, category, min_confidence, min_show_count, api_key }) => {
      const start = Date.now();

      const auth = await authorize(env, request, api_key);
      if (!auth.authorized) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "_auth_failure", paymentMethod: "free_tier", processingTimeMs: 0, success: false }));
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

      try {
        const extractions = [];
        const missing: string[] = [];

        for (const id of show_ids) {
          const cached = await cacheGet(env.PODCAST_CACHE, id);
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
        if (metering) ctx.waitUntil(metering.record({ toolName: "compare_products_across_shows", paymentMethod: meteringMethod(auth.method), amountUsd: auth.method === "api_key" ? TOOL_PRICE_USD : 0, processingTimeMs: Date.now() - start, success: true }));
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
      } catch (err) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "compare_products_across_shows", paymentMethod: meteringMethod(auth.method), processingTimeMs: Date.now() - start, success: false }));
        const message = err instanceof OpenAI.APIError
          ? "upstream service temporarily unavailable"
          : (err instanceof Error ? err.message : "internal error");
        return errorResult(`Cross-show comparison failed: ${message}`);
      }
    }
  );

  // --------------------------------------------------------------------------
  // TOOL 5: generate_show_notes_section
  // --------------------------------------------------------------------------

  server.tool(
    "generate_show_notes_section",
    "Format extracted podcast products into a shoppable show notes section. Returns a ready-to-paste markdown or HTML product list, grouped by endorsement strength (strong/moderate/mention), with affiliate links where resolved. Use after extract_podcast_products — either pass episode_id to use cached extraction, or pass products[] directly. Handles null affiliate_link gracefully (shows product name without link). Format: markdown (default) produces copy-paste text for show notes editors; html produces embeddable markup. Style: full (default) groups by endorsement with context quotes; minimal produces a compact list.",
    {
      episode_id: z
        .string()
        .max(ID_MAX_CHARS)
        .optional()
        .describe(
          "Episode identifier from a prior extract_podcast_products call — uses cached extraction. Example: 'huberman-lab-ep-123'"
        ),
      products: z
        .array(
          z.object({
            name: z.string(),
            category: z.string(),
            mention_context: z.string().optional(),
            speaker: z.string().nullable().optional(),
            confidence: z.number(),
            recommendation_strength: z.string(),
            affiliate_link: z.string().nullable().optional(),
            mention_count: z.number().optional(),
          })
        )
        .optional()
        .describe(
          "Raw products array from extract_podcast_products output. Use instead of episode_id when passing data directly."
        ),
      format: z
        .enum(["markdown", "html"])
        .optional()
        .describe("Output format: markdown (default) or html"),
      style: z
        .enum(["minimal", "full"])
        .optional()
        .describe(
          "minimal = name + category list; full (default) = grouped by endorsement strength with context quotes"
        ),
      api_key: z
        .string()
        .max(API_KEY_MAX_CHARS)
        .optional()
        .describe("Optional API key for paid access beyond the free tier"),
    },
    async ({ episode_id, products: rawProducts, format, style, api_key }) => {
      const start = Date.now();

      const auth = await authorize(env, request, api_key);
      if (!auth.authorized) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "_auth_failure", paymentMethod: "free_tier", processingTimeMs: 0, success: false }));
        return paymentRequiredResult(auth.reason ?? "Payment required");
      }

      try {
        let products;
        if (rawProducts) {
          products = rawProducts as import("./types.js").ProductMention[];
        } else if (episode_id) {
          const cached = await cacheGet(env.PODCAST_CACHE, episode_id);
          if (!cached) {
            return errorResult(`No cached extraction found for episode_id: "${episode_id}". Run extract_podcast_products first.`);
          }
          products = cached.products;
        } else {
          return errorResult("Provide either episode_id or products[].");
        }

        const fmt = format ?? "markdown";
        const sty = style ?? "full";
        const section = generateShowNotes(products, fmt, sty);

        if (metering) ctx.waitUntil(metering.record({ toolName: "generate_show_notes_section", paymentMethod: meteringMethod(auth.method), amountUsd: auth.method === "api_key" ? TOOL_PRICE_USD : 0, processingTimeMs: Date.now() - start, success: true }));
        return { content: [{ type: "text", text: section }] };
      } catch (err) {
        if (metering) ctx.waitUntil(metering.record({ toolName: "generate_show_notes_section", paymentMethod: meteringMethod(auth.method), processingTimeMs: Date.now() - start, success: false }));
        const message = err instanceof Error ? err.message : "internal error";
        return errorResult(`Show notes generation failed: ${message}`);
      }
    }
  );

  return server;
}

// ============================================================================
// DISCOVERY CONTENT (agent-readable examples + LLM tool docs)
// ============================================================================

const LLMS_TXT = `# podcast-commerce-mcp

MCP server for podcast commerce intelligence. Extracts affiliate products, sponsor segments, and brand recommendations from podcast transcripts.

## Tools

### extract_podcast_products
- Input: transcript text or URL (up to 100,000 chars), optional episode_id for caching, optional category_filter
- Output: products array [{name, category, mention_context, speaker, confidence, recommendation_strength, affiliate_link, mention_count}], sponsor_segments array, _meta
- Typical output: 300-600 tokens
- Latency: 2-4 seconds (OpenAI GPT-4o-mini)
- Price: free for first 200 calls/day, $0.01/call with API key

### analyze_episode_sponsors
- Input: same as extract_podcast_products; reuses cache if episode_id matches prior extraction
- Output: sponsors array [{sponsor_name, segment_start_context, read_type, estimated_read_through, call_to_action}], sponsor_count, avg_read_through, cta_rate (0–1 fraction of sponsors with trackable CTAs)
- Typical output: 150-300 tokens
- Latency: 2-4 seconds (or <100ms if cache hit)

### track_product_trends
- Input: episode_ids (list of previously extracted episode IDs), optional category_filter
- Output: trends array [{name, category, trend (rising|stable|falling), episodes_present, total_mentions, avg_recommendation_strength, brand: string | null — brand extracted from product name (e.g. "Oura" from "Oura Ring"), null if generic}], top_category (category with most trending products)
- Typical output: 200-400 tokens
- Latency: <100ms (local computation, no OpenAI call)
- Requires: prior extract_podcast_products calls for each episode_id

### compare_products_across_shows
- Input: show_ids (list of previously extracted show/episode IDs), optional category, optional min_confidence (default 0.85), optional min_show_count (default 2)
- Output: products array [{product_name, brand, category, shows: [{show_id, episode_id, mention_context, host, confidence, recommendation_strength}], show_count, avg_confidence, recommendation_consensus}]
- Typical output: 300-600 tokens
- Latency: <100ms (local computation, no OpenAI call)
- Requires: prior extract_podcast_products calls for each show_id
- Use case: replaces 3-call manual join with 1 call; ideal for affiliate page generation and multi-show product research

### generate_show_notes_section
- Input: episode_id (uses cached extraction, no re-processing) OR products[] array, optional format (markdown|html, default markdown), optional style (minimal|full, default full)
- Output: formatted shoppable show notes section — products grouped by endorsement strength with context quotes and affiliate links
- Typical output: 200-500 tokens
- Latency: <10ms (pure formatting, no OpenAI call)
- Requires: prior extract_podcast_products call (uses KV cache); or pass products[] directly
- Use case: paste directly into show notes or blog post; full style groups by endorsement strength with context quotes

## Categories
physical_goods, saas, course, service, supplement, media, event, other

## Auth
Set MCP_API_KEYS=your-key in your MCP config for paid access. Free tier: 200 calls/day, no key required.`;

function getExamplesResponse() {
  return {
    mcp: "podcast-commerce-mcp",
    version: SERVER_VERSION,
    examples: [
      {
        tool: "extract_podcast_products",
        description: "Extract product and brand mentions from a podcast transcript. Returns structured data: product name, category, confidence score, recommendation_strength, affiliate_link, and aestheticTags (warmth/density/origin/tradition). Sponsor segments returned separately. Cached by episode_id so downstream tools don't re-process. affiliate_link is null until ChatAds is configured.",
        input: {
          transcript: "...today's episode is brought to you by AG1. I've been taking it every morning for six months now and honestly I feel great. Use code HUBERMAN for a free year's supply of Vitamin D... We also talked about Momentous supplements — their omega-3 is the only one I trust, cold-pressed, no fishy aftertaste. And I want to mention the Oura Ring. I've been wearing it for sleep tracking for two years. They're not a sponsor, just a genuine rec...",
          episode_id: "huberman-ep-312",
        },
        output: {
          episode_id: "huberman-ep-312",
          products: [
            { name: "AG1 (Athletic Greens)", category: "supplement", mention_context: "today's episode is brought to you by AG1. I've been taking it every morning for six months", speaker: null, confidence: 0.97, recommendation_strength: "strong", affiliate_link: null, mention_count: 2 },
            { name: "Momentous Omega-3", category: "supplement", mention_context: "their omega-3 is the only one I trust, cold-pressed, no fishy aftertaste", speaker: null, confidence: 0.91, recommendation_strength: "strong", affiliate_link: null, mention_count: 1 },
            { name: "Oura Ring", category: "physical_goods", mention_context: "I've been wearing it for sleep tracking for two years. They're not a sponsor, just a genuine rec", speaker: null, confidence: 0.95, recommendation_strength: "strong", affiliate_link: null, mention_count: 1 },
          ],
          sponsor_segments: [
            { sponsor_name: "AG1", segment_start_context: "today's episode is brought to you by AG1", read_type: "host_read", estimated_read_through: 0.72, call_to_action: "code HUBERMAN for a free year's supply of Vitamin D" },
          ],
          _meta: { processing_time_ms: 1840, ai_cost_usd: 0.0031, cache_hit: false },
        },
        value_narrative: "recommendation_strength: 'strong' on Oura Ring with no sponsor tag = organic endorsement from a trusted host. Higher-converting than a sponsor read. Find the Oura affiliate program and place it in show notes immediately. AG1 estimated_read_through: 0.72 — 72% read-through. Benchmark your own shows against this. Run analyze_episode_sponsors with episode_id: 'huberman-ep-312' for CPM estimates without re-processing.",
        eval: { F1: 0.95, latency_ms: 8220, cost_usd: 0.000365 },
      },
      {
        tool: "generate_show_notes_section",
        description: "Formats extracted products into a ready-to-publish shoppable show notes section. Call after extract_podcast_products. Accepts episode_id (uses KV cache — no re-extraction) or a products[] array directly. No AI call — pure formatting, <10ms.",
        input: {
          episode_id: "huberman-ep-312",
          format: "markdown",
          style: "full",
        },
        output: "## Products in This Episode\n\n### ⭐ Top Picks\n\n- **AG1 (Athletic Greens)** — supplement\n  > *\"today's episode is brought to you by AG1. I've been taking it every morning for six months\"*\n- **Momentous Omega-3** — supplement\n  > *\"their omega-3 is the only one I trust, cold-pressed, no fishy aftertaste\"*\n- **Oura Ring** — physical_goods\n  > *\"I've been wearing it for sleep tracking for two years. They're not a sponsor, just a genuine rec\"*\n\n---\n*Affiliate links help support the show. Thank you.*",
        value_narrative: "Paste directly into show notes — no manual formatting step. Reads from the same KV cache as extract_podcast_products so no OpenAI cost for formatting. When ChatAds is configured, affiliate_link fields populate automatically and every product link is monetized and tracked.",
      },
      {
        tool: "analyze_episode_sponsors",
        description: "Score sponsor segments from a cached podcast extraction. Per-sponsor: estimated_cpm_usd, read-through, host_fit_score, CTA quality. Top-level aggregates: sponsor_count, avg_read_through, cta_rate (fraction with trackable CTAs — gate: cta_rate > 0 before running CTA extraction). No AI cost. Call after extract_podcast_products.",
        input: { episode_id: "huberman-ep-312" },
        output: {
          episode_id: "huberman-ep-312",
          sponsors: [{ sponsor_name: "AG1", read_type: "host_read", estimated_cpm_usd: 42, estimated_read_through: 0.72, host_fit_score: 0.91, call_to_action: "code HUBERMAN for a free year's supply of Vitamin D", cta_quality: "high", recommendation: "Renew at $45 CPM — host credibility + high read-through justify premium" }],
          _meta: { processing_time_ms: 85, ai_cost_usd: 0, cache_hit: true },
        },
        value_narrative: "CPM $42, read-through 0.72, fit 0.91. Use estimated_cpm_usd as a floor in your next sponsorship negotiation. host_fit_score below 0.7 = misaligned sponsor — cite this data to decline or reprice.",
      },
      {
        tool: "track_product_trends",
        description: "Identify rising and falling product trends across episodes. Per trend: brand (null for generics), category, trend direction (rising/stable/falling), episodes_present, total_mentions, avg_recommendation_strength (0–3 scale — use to prioritize affiliate outreach). Top-level: top_category (dominant category this period). Reads from cached extractions — no re-processing cost.",
        input: { show_id: "huberman-lab", weeks: 8 },
        output: {
          show_id: "huberman-lab",
          trending_up: [{ product: "Momentous Omega-3", category: "supplement", mention_velocity: 2.3, episodes_mentioned: 5, trend: "hot" }, { product: "Oura Ring", category: "physical_goods", mention_velocity: 1.8, episodes_mentioned: 4, trend: "rising" }],
          trending_down: [{ product: "Eight Sleep Pod", category: "physical_goods", mention_velocity: 0.3, episodes_mentioned: 1, trend: "fading" }],
          _meta: { episodes_analyzed: 24, date_range: "8 weeks" },
        },
        value_narrative: "Momentous trending hot (2.3× velocity) — affiliate outreach NOW before it peaks. Eight Sleep fading — don't invest in that relationship. Act on 'hot' items within 48h for maximum conversion window.",
      },
      {
        tool: "compare_products_across_shows",
        description: "Find products and brands mentioned across multiple shows. Resolves entity names (e.g. 'Fiskars Snips' + 'Fiskars Broadfork' → brand: Fiskars), ranks by avg_confidence × show_count, and returns recommendation_consensus across shows.",
        input: { show_ids: ["huberman-lab", "tim-ferriss-show", "all-in-podcast"], min_confidence: 0.8 },
        output: {
          products: [{ product_name: "AG1 (Athletic Greens)", show_count: 3, avg_confidence: 0.96, recommendation_consensus: "unanimous", shows: ["huberman-lab", "tim-ferriss-show", "all-in-podcast"] }],
          brands: [{ brand: "AG1", product_count: 2, show_count: 3, avg_confidence: 0.95 }],
          _meta: { shows_analyzed: 3, episodes_analyzed: 72 },
        },
        value_narrative: "AG1 at unanimous consensus across 3 major shows = category-defining endorsement. This is multi-show proof for a sponsor pitch deck. Shows that recommend the same product independently have no coordinated sponsor bias — worth 3-5× a single-show mention in advertiser credibility.",
      },
    ],
  };
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // Usage dashboard (traction monitoring)
    if (url.pathname === "/usage" && request.method === "GET") {
      if (!env.TELEMETRY) {
        return new Response(JSON.stringify({ error: "TELEMETRY KV not configured" }), {
          status: 503, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      const metering = new CloudflareMetering(env.TELEMETRY);
      const summaries = await Promise.all(TOOL_NAMES.map((t) => metering.getToolSummary(t)));
      return new Response(
        JSON.stringify({ tools: summaries, as_of: new Date().toISOString() }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // Agent discovery: real-output examples (no auth required)
    if (url.pathname === "/examples" && request.method === "GET") {
      return new Response(JSON.stringify(getExamplesResponse()), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // Agent discovery: LLM-readable tool docs (no auth required)
    if (url.pathname === "/.well-known/llms.txt" && request.method === "GET") {
      return new Response(LLMS_TXT, {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS },
      });
    }

    // MCP Streamable HTTP endpoint (stateless)
    if (url.pathname === "/mcp" || url.pathname === "/") {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless — no session tracking required
      });

      const server = createMcpServer(env, request, ctx);
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

  // Keep-warm: CF cron fires every 5 min to reduce cold-start probability.
  // Handles the scheduled event silently — no external calls needed.
  async scheduled(_event: unknown, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // no-op — wrangler.toml cron trigger keeps this isolate alive
  },
};
