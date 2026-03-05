/**
 * Transcript Fetcher — fetch or pass through podcast transcripts.
 *
 * Supports:
 *   - YouTube URLs: fetches auto-generated captions via youtube-transcript
 *   - Raw transcript text: passed through directly with a generated episodeId
 */

import { YoutubeTranscript } from "youtube-transcript";
import { createHash } from "node:crypto";

// ============================================================================
// YOUTUBE ID EXTRACTION
// ============================================================================

const YOUTUBE_ID_PATTERNS = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

function extractVideoId(url: string): string | null {
  for (const pattern of YOUTUBE_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

// ============================================================================
// FETCHER
// ============================================================================

/**
 * Fetch a transcript from a YouTube URL or raw text.
 *
 * @param source - YouTube URL or raw transcript text
 * @param sourceType - "url" to fetch from YouTube, "transcript" to use text directly
 * @returns { text, episodeId, title }
 * @throws Error with descriptive message on failure
 */
export async function fetchTranscript(
  source: string,
  sourceType: "url" | "transcript",
): Promise<{ text: string; episodeId: string; title: string }> {
  if (sourceType === "transcript") {
    const text = source.trim();
    if (!text) {
      throw new Error("Transcript text is empty.");
    }
    const episodeId = createHash("sha256")
      .update(text.slice(0, 100))
      .digest("hex")
      .slice(0, 16);
    return { text, episodeId, title: "Custom Transcript" };
  }

  // sourceType === "url"
  const videoId = extractVideoId(source);
  if (!videoId) {
    throw new Error(
      `Could not extract YouTube video ID from URL: "${source}". ` +
        `Expected format: https://youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID`,
    );
  }

  let segments;
  try {
    segments = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch YouTube transcript for video "${videoId}": ${message}`,
    );
  }

  if (!segments || segments.length === 0) {
    throw new Error(
      `No transcript available for YouTube video "${videoId}". ` +
        `The video may not have captions enabled.`,
    );
  }

  const text = segments
    .map((seg) => seg.text.replace(/\[.*?\]/g, "").trim())
    .filter((t) => t.length > 0)
    .join(" ");

  return {
    text,
    episodeId: videoId,
    title: "YouTube Podcast",
  };
}
