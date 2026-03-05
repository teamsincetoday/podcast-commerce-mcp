#!/usr/bin/env node

/**
 * CLI entry point for the Podcast Commerce Intelligence MCP Server.
 *
 * Usage:
 *   npx podcast-commerce-mcp          # Start MCP server (stdio transport)
 *   npx podcast-commerce-mcp --help   # Show help
 *   npx podcast-commerce-mcp --version
 *
 * Environment Variables:
 *   OPENAI_API_KEY     Required. OpenAI API key for transcript extraction.
 *   AGENT_ID           Optional. Agent identifier for free tier tracking.
 *   MCP_API_KEYS       Optional. Comma-separated API keys for paid access.
 *   CACHE_DIR          Optional. SQLite file location (default: ./data/cache.db).
 *   PAYMENT_ENABLED    Optional. Set to "true" to enforce payment limits.
 */

import { startStdioServer } from "./server.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`
Podcast Commerce Intelligence MCP Server v0.1.0

Usage:
  npx podcast-commerce-mcp          Start MCP server (stdio transport)
  npx podcast-commerce-mcp --help   Show this help message
  npx podcast-commerce-mcp --version Show version

Environment Variables:
  OPENAI_API_KEY     Required. OpenAI API key for NLP extraction.
  AGENT_ID           Optional. Agent identifier for free tier tracking.
  MCP_API_KEYS       Optional. Comma-separated API keys for paid access.
  CACHE_DIR          Optional. Path to SQLite cache file (default: ./data/cache.db).
  PAYMENT_ENABLED    Optional. Set to "true" to enforce payment/rate limits.

Tools (3 total):
  extract_podcast_products  Extract products and brands from a transcript
  analyze_episode_sponsors  Identify sponsor segments and read-through rates
  track_product_trends      Compare product mentions across multiple episodes

Pricing:
  Free tier: ${5} extractions/day per agent
  Paid: $0.001/call with MCP_API_KEYS

Documentation:
  https://github.com/since-today/podcast-commerce-mcp
\n`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write("0.1.0\n");
  process.exit(0);
}

startStdioServer().catch((error: unknown) => {
  console.error("Failed to start Podcast Commerce MCP server:", error);
  process.exit(1);
});
