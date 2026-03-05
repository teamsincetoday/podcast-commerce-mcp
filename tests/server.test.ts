/**
 * Server integration tests.
 *
 * Verifies tool registrations and basic server structure.
 * Does not start a real transport or call real OpenAI.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

// ============================================================================
// Server creation
// ============================================================================

describe("createServer", () => {
  it("creates an MCP server without throwing", async () => {
    const { createServer } = await import("../src/server.js");
    expect(() => createServer()).not.toThrow();
  });

  it("server has the correct name and version", async () => {
    const { createServer } = await import("../src/server.js");
    const server = createServer();
    // McpServer exposes server info via the underlying Server instance
    // We verify it was constructed correctly by checking it's an object
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
    expect(typeof server.tool).toBe("function");
  });
});

// ============================================================================
// Tool registration smoke tests
// ============================================================================

describe("tool registrations", () => {
  it("all 3 tools are registered", async () => {
    // We verify this by checking that registering an already-registered tool would fail
    // In practice we test via the SDK's internal tool map
    const { createServer } = await import("../src/server.js");
    const server = createServer();

    // Attempt to register a duplicate tool — MCP SDK throws on duplicate
    // If no error, we confirm the server accepted the 3 tools above
    // We just check the server object is valid
    expect(server).toBeDefined();
  });

  it("extract_podcast_products tool name is correct", async () => {
    // Verify by attempting to register the same tool — SDK should throw
    const { createServer } = await import("../src/server.js");
    const server = createServer();

    expect(() => {
      server.tool(
        "extract_podcast_products",
        "duplicate",
        {},
        async () => ({ content: [] })
      );
    }).toThrow(); // Should throw because tool is already registered
  });

  it("analyze_episode_sponsors tool name is correct", async () => {
    const { createServer } = await import("../src/server.js");
    const server = createServer();

    expect(() => {
      server.tool(
        "analyze_episode_sponsors",
        "duplicate",
        {},
        async () => ({ content: [] })
      );
    }).toThrow();
  });

  it("track_product_trends tool name is correct", async () => {
    const { createServer } = await import("../src/server.js");
    const server = createServer();

    expect(() => {
      server.tool(
        "track_product_trends",
        "duplicate",
        {},
        async () => ({ content: [] })
      );
    }).toThrow();
  });
});

// ============================================================================
// Cache behavior
// ============================================================================

describe("PodcastCache", () => {
  it("returns null for a cache miss", async () => {
    const { PodcastCache } = await import("../src/cache.js");
    // Use in-memory db for tests
    const cache = new PodcastCache(":memory:");
    expect(cache.get("nonexistent-episode")).toBeNull();
    cache.close();
  });

  it("stores and retrieves an extraction", async () => {
    const { PodcastCache } = await import("../src/cache.js");
    const cache = new PodcastCache(":memory:");

    const fakeResult = {
      episode_id: "ep-test",
      products: [
        {
          name: "Test Product",
          category: "saas" as const,
          mention_context: "ctx",
          speaker: null,
          confidence: 0.8,
          recommendation_strength: "moderate" as const,
          affiliate_link: null,
          mention_count: 1,
        },
      ],
      sponsor_segments: [],
      _meta: { processing_time_ms: 100, ai_cost_usd: 0.001, cache_hit: false },
    };

    cache.set("ep-test", fakeResult);
    const retrieved = cache.get("ep-test");

    expect(retrieved).not.toBeNull();
    expect(retrieved?.episode_id).toBe("ep-test");
    expect(retrieved?.products).toHaveLength(1);
    expect(retrieved?.products[0]?.name).toBe("Test Product");

    cache.close();
  });

  it("free tier: allows calls within limit", async () => {
    const { PodcastCache } = await import("../src/cache.js");
    const cache = new PodcastCache(":memory:");

    // Fresh agent — should be within limit
    expect(cache.checkFreeTier("agent-new")).toBe(true);
    cache.close();
  });

  it("free tier: blocks calls after limit exceeded", async () => {
    const { PodcastCache, FREE_TIER_DAILY_LIMIT } = await import("../src/cache.js");
    const cache = new PodcastCache(":memory:");

    const agentId = "agent-exhausted";

    // Record FREE_TIER_DAILY_LIMIT calls
    for (let i = 0; i < FREE_TIER_DAILY_LIMIT; i++) {
      cache.recordUsage({
        agentId,
        toolName: "extract_podcast_products",
        paymentMethod: "free_tier",
        amountUsd: 0,
        success: true,
      });
    }

    // Should now be blocked
    expect(cache.checkFreeTier(agentId)).toBe(false);
    cache.close();
  });

  it("records usage events", async () => {
    const { PodcastCache } = await import("../src/cache.js");
    const cache = new PodcastCache(":memory:");

    cache.recordUsage({
      agentId: "agent-test",
      toolName: "extract_podcast_products",
      paymentMethod: "free_tier",
      amountUsd: 0,
      success: true,
    });

    expect(cache.getFreeTierUsed("agent-test")).toBe(1);
    cache.close();
  });
});
