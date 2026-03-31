/**
 * Podcast Commerce Extractor — Apify Actor
 *
 * Thin wrapper around podcast-commerce-mcp (sincetoday.workers.dev).
 * Accepts a podcast transcript or URL, returns structured product data.
 *
 * Endpoint: https://podcast-commerce-mcp.sincetoday.workers.dev/mcp
 * Protocol: MCP Streamable HTTP (JSON-RPC 2.0 over POST)
 */

import { Actor } from "apify";

const MCP_ENDPOINT = "https://podcast-commerce-mcp.sincetoday.workers.dev/mcp";
const TRANSCRIPT_MAX_CHARS = 100_000;

async function fetchTranscriptFromUrl(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "ApifyActor/podcast-commerce-mcp" },
  });
  if (!resp.ok) throw new Error(`Failed to fetch URL ${url}: HTTP ${resp.status}`);
  const html = await resp.text();
  // Strip HTML tags — best-effort transcript extraction from page source
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TRANSCRIPT_MAX_CHARS);
}

async function callMcp(toolName, args) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const resp = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`MCP endpoint error HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";

  // Handle SSE streaming response
  if (contentType.includes("text/event-stream")) {
    const text = await resp.text();
    const lines = text.split("\n").filter((l) => l.startsWith("data: "));
    for (const line of lines.reverse()) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.result) return data.result;
        if (data.error) throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
      } catch {
        // skip unparseable lines
      }
    }
    throw new Error("No result found in SSE stream");
  }

  // Handle JSON response
  const data = await resp.json();
  if (data.error) throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
  return data.result;
}

function parseProductsFromResult(result) {
  // MCP result is { content: [{ type: 'text', text: '<json string>' }] }
  if (!result?.content?.length) return null;
  const textContent = result.content.find((c) => c.type === "text");
  if (!textContent?.text) return null;
  try {
    return JSON.parse(textContent.text);
  } catch {
    return { raw: textContent.text };
  }
}

await Actor.init();

try {
  const input = await Actor.getInput();

  // Validate input
  if (!input?.transcriptText && !input?.podcastUrl) {
    throw new Error("Input must provide either 'transcriptText' or 'podcastUrl'.");
  }

  let transcript = input.transcriptText ?? "";

  // Fetch transcript from URL if provided
  if (!transcript && input.podcastUrl) {
    console.log(`Fetching transcript from URL: ${input.podcastUrl}`);
    transcript = await fetchTranscriptFromUrl(input.podcastUrl);
    console.log(`Fetched ${transcript.length} chars from URL.`);
  }

  if (!transcript.trim()) {
    throw new Error("Transcript is empty. Provide 'transcriptText' or a URL with transcript content.");
  }

  const episodeId = input.episodeId ?? `actor-run-${Date.now()}`;
  const showName = input.showName ?? "";
  const categoryFilter = input.categoryFilter ?? [];
  const minConfidence = input.minConfidence ?? 0;

  console.log(`Calling extract_podcast_products — episode: ${episodeId}`);

  const mcpArgs = {
    transcript: transcript.slice(0, TRANSCRIPT_MAX_CHARS),
    episode_id: episodeId,
    ...(showName && { show_name: showName }),
    ...(categoryFilter.length && { category_filter: categoryFilter }),
  };

  const result = await callMcp("extract_podcast_products", mcpArgs);
  const products = parseProductsFromResult(result);

  if (!products) {
    console.warn("No structured product data in response — saving raw result.");
    await Actor.pushData({ raw_result: result });
    await Actor.exit();
    process.exit(0);
  }

  // Filter by confidence if requested
  const productList = Array.isArray(products.products) ? products.products : [];
  const filtered =
    minConfidence > 0
      ? productList.filter((p) => (p.confidence ?? 0) >= minConfidence)
      : productList;

  // Push each product as a separate dataset item (Apify best practice for crawlers)
  if (filtered.length > 0) {
    await Actor.pushData(filtered);
    console.log(`Pushed ${filtered.length} products to dataset.`);
  } else {
    console.log("No products found (or all filtered by minConfidence).");
    await Actor.pushData({
      episode_id: episodeId,
      products: [],
      message: "No product mentions found in transcript.",
    });
  }

  // Also save summary metadata
  const summary = {
    episode_id: episodeId,
    show_name: showName || null,
    total_products: filtered.length,
    ...(products.extraction_stats && { extraction_stats: products.extraction_stats }),
    ...(products.episode_summary && { episode_summary: products.episode_summary }),
    source: "podcast-commerce-mcp@sincetoday.workers.dev",
  };
  console.log("Summary:", JSON.stringify(summary, null, 2));
} catch (err) {
  console.error("Actor failed:", err.message);
  await Actor.fail(err.message);
}

await Actor.exit();
