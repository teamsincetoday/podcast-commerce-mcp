/**
 * Analysis Cache — SQLite-backed cache for episode extraction results.
 *
 * Stores EpisodeExtraction objects keyed by episode_id.
 * Uses better-sqlite3 for synchronous, thread-safe operations.
 *
 * Table: episode_cache
 *   episode_id TEXT PRIMARY KEY
 *   data       TEXT NOT NULL  (JSON-serialized EpisodeExtraction)
 *   created_at INTEGER NOT NULL  (Unix timestamp)
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { EpisodeExtraction } from "./types.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_DB_PATH = "./data/cache.db";

// ============================================================================
// CACHE INTERFACE
// ============================================================================

export interface AnalysisCacheStore {
  get(episodeId: string): EpisodeExtraction | null;
  set(episodeId: string, data: EpisodeExtraction): void;
  getAll(): EpisodeExtraction[];
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

class AnalysisCacheImpl implements AnalysisCacheStore {
  private readonly db: Database.Database;
  private readonly stmtGet: Database.Statement;
  private readonly stmtSet: Database.Statement;
  private readonly stmtGetAll: Database.Statement;

  constructor(dbPath?: string) {
    const resolvedPath = resolve(dbPath ?? process.env["DB_PATH"] ?? DEFAULT_DB_PATH);

    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.initSchema();

    this.stmtGet = this.db.prepare(
      `SELECT data FROM episode_cache WHERE episode_id = ?`,
    );

    this.stmtSet = this.db.prepare(
      `INSERT OR REPLACE INTO episode_cache (episode_id, data, created_at)
       VALUES (?, ?, ?)`,
    );

    this.stmtGetAll = this.db.prepare(
      `SELECT data FROM episode_cache ORDER BY created_at DESC`,
    );
  }

  get(episodeId: string): EpisodeExtraction | null {
    const row = this.stmtGet.get(episodeId) as { data: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.data) as EpisodeExtraction;
    } catch {
      return null;
    }
  }

  set(episodeId: string, data: EpisodeExtraction): void {
    const now = Math.floor(Date.now() / 1000);
    this.stmtSet.run(episodeId, JSON.stringify(data), now);
  }

  getAll(): EpisodeExtraction[] {
    const rows = this.stmtGetAll.all() as Array<{ data: string }>;
    const results: EpisodeExtraction[] = [];
    for (const row of rows) {
      try {
        results.push(JSON.parse(row.data) as EpisodeExtraction);
      } catch {
        // Skip corrupted entries
      }
    }
    return results;
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episode_cache (
        episode_id TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_episode_cache_created
        ON episode_cache(created_at);
    `);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create an analysis cache backed by SQLite.
 *
 * @param dbPath - Optional path to the SQLite database file.
 *   Defaults to ./data/cache.db or DB_PATH env var.
 *   Pass ":memory:" for an in-memory database (useful in tests).
 * @returns AnalysisCacheStore with get/set/getAll methods
 */
export function createAnalysisCache(dbPath?: string): AnalysisCacheStore {
  return new AnalysisCacheImpl(dbPath);
}
