/**
 * Usage Metering — SQLite-backed usage tracking, rate limiting, and revenue reporting.
 *
 * Tracks who's using the MCP, how much, and what revenue is generated.
 * Provides per-agent rate limiting with configurable sliding windows.
 * Uses better-sqlite3 for synchronous, thread-safe operations.
 *
 * Features:
 * - Per-agent call tracking by wallet address
 * - Per-tool revenue tracking
 * - Sliding window rate limiting (per-minute, per-hour, per-day)
 * - Admin/monitoring stats queries
 * - Auto-cleanup of old records
 * - Factory function for easy instantiation
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configurable rate limits per agent.
 */
export interface RateLimits {
  /** Maximum calls per minute. Default: 30 */
  perMinute: number;
  /** Maximum calls per hour. Default: 500 */
  perHour: number;
  /** Maximum calls per day. Default: 5000 */
  perDay: number;
}

/**
 * Options for the UsageMetering constructor.
 */
export interface MeteringOptions {
  /** Path to the SQLite database file. Defaults to `./data/cache.db` (shared with analysis cache). */
  dbPath?: string;
  /** Rate limits per agent. */
  rateLimits?: Partial<RateLimits>;
}

/**
 * An event to record in the usage log.
 */
export interface UsageEvent {
  /** Agent identifier — wallet address, API key hash, or IP. */
  agentId: string;
  /** Name of the MCP tool invoked. */
  toolName: string;
  /** Payment method used for this call. */
  paymentMethod: "free_tier" | "x402" | "api_key";
  /** Amount paid in USD (0 for free tier). */
  amountUsd?: number;
  /** Processing time in milliseconds. */
  processingTimeMs?: number;
  /** Whether the call succeeded. */
  success?: boolean;
  /** Error message if the call failed. */
  errorMessage?: string;
}

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Which window was exceeded (if rate limited). */
  limitExceeded?: "per_minute" | "per_hour" | "per_day";
  /** Calls remaining in each window. */
  remaining: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  /** Seconds until the exceeded limit resets (if rate limited). */
  retryAfterSeconds?: number;
}

/**
 * Per-agent usage statistics.
 */
export interface AgentStats {
  agentId: string;
  totalCalls: number;
  totalRevenue: number;
  callsByTool: Record<string, number>;
  avgProcessingTime: number;
  errorRate: number;
  period: string;
}

/**
 * Per-tool usage statistics.
 */
export interface ToolStats {
  toolName: string;
  totalCalls: number;
  totalRevenue: number;
  uniqueAgents: number;
  avgProcessingTime: number;
  errorRate: number;
  period: string;
}

/**
 * Aggregated overview statistics.
 */
export interface OverviewStats {
  totalCalls: number;
  totalRevenue: number;
  uniqueAgents: number;
  callsByTool: Record<string, number>;
  revenueByTool: Record<string, number>;
  callsByMethod: Record<string, number>;
  avgProcessingTime: number;
  period: string;
}

/**
 * Revenue breakdown statistics.
 */
export interface RevenueStats {
  totalRevenue: number;
  revenueByTool: Record<string, number>;
  revenueByMethod: Record<string, number>;
  revenueByDay: Array<{ date: string; revenue: number }>;
  period: string;
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

type StatsPeriod = "day" | "week" | "month";

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const DEFAULT_DB_PATH = "./data/cache.db";

const DEFAULT_RATE_LIMITS: RateLimits = {
  perMinute: 30,
  perHour: 500,
  perDay: 5000,
};

/**
 * Convert a period name to a duration in seconds.
 * Uses a function instead of a Record to satisfy noUncheckedIndexedAccess.
 */
function periodToSeconds(period: StatsPeriod): number {
  switch (period) {
    case "day":
      return 86_400;
    case "week":
      return 604_800;
    case "month":
      return 2_592_000;
  }
}

// ============================================================================
// USAGE METERING
// ============================================================================

export class UsageMetering {
  private readonly db: Database.Database;
  private readonly rateLimits: RateLimits;

  // Prepared statements for performance
  private readonly stmtRecord: Database.Statement;
  private readonly stmtCountWindow: Database.Statement;
  private readonly stmtCleanup: Database.Statement;

  // Stats prepared statements
  private readonly stmtAgentTotalCalls: Database.Statement;
  private readonly stmtAgentTotalRevenue: Database.Statement;
  private readonly stmtAgentCallsByTool: Database.Statement;
  private readonly stmtAgentAvgProcessingTime: Database.Statement;
  private readonly stmtAgentErrorRate: Database.Statement;

  private readonly stmtToolTotalCalls: Database.Statement;
  private readonly stmtToolTotalRevenue: Database.Statement;
  private readonly stmtToolUniqueAgents: Database.Statement;
  private readonly stmtToolAvgProcessingTime: Database.Statement;
  private readonly stmtToolErrorRate: Database.Statement;

  private readonly stmtOverviewTotalCalls: Database.Statement;
  private readonly stmtOverviewTotalRevenue: Database.Statement;
  private readonly stmtOverviewUniqueAgents: Database.Statement;
  private readonly stmtOverviewCallsByTool: Database.Statement;
  private readonly stmtOverviewRevenueByTool: Database.Statement;
  private readonly stmtOverviewCallsByMethod: Database.Statement;
  private readonly stmtOverviewAvgProcessingTime: Database.Statement;

  private readonly stmtRevenueTotal: Database.Statement;
  private readonly stmtRevenueByTool: Database.Statement;
  private readonly stmtRevenueByMethod: Database.Statement;
  private readonly stmtRevenueByDay: Database.Statement;

  constructor(options?: MeteringOptions) {
    const cacheDir = process.env.ANALYSIS_CACHE_DIR;
    const dbPath = resolve(
      options?.dbPath
        ?? (cacheDir ? `${cacheDir}/cache.db` : DEFAULT_DB_PATH)
    );

    this.rateLimits = {
      ...DEFAULT_RATE_LIMITS,
      ...options?.rateLimits,
    };

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open database with WAL mode for better concurrent read performance
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    // Create schema
    this.initSchema();

    // Prepare statements
    this.stmtRecord = this.db.prepare(
      `INSERT INTO usage_events (agent_id, tool_name, timestamp, payment_method, amount_usd, processing_time_ms, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.stmtCountWindow = this.db.prepare(
      `SELECT COUNT(*) as count FROM usage_events
       WHERE agent_id = ? AND timestamp > ?`
    );

    this.stmtCleanup = this.db.prepare(
      `DELETE FROM usage_events WHERE timestamp < ?`
    );

    // Agent stats
    this.stmtAgentTotalCalls = this.db.prepare(
      `SELECT COUNT(*) as count FROM usage_events
       WHERE agent_id = ? AND timestamp > ?`
    );

    this.stmtAgentTotalRevenue = this.db.prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) as total FROM usage_events
       WHERE agent_id = ? AND timestamp > ?`
    );

    this.stmtAgentCallsByTool = this.db.prepare(
      `SELECT tool_name, COUNT(*) as count FROM usage_events
       WHERE agent_id = ? AND timestamp > ?
       GROUP BY tool_name`
    );

    this.stmtAgentAvgProcessingTime = this.db.prepare(
      `SELECT COALESCE(AVG(processing_time_ms), 0) as avg_time FROM usage_events
       WHERE agent_id = ? AND timestamp > ? AND processing_time_ms IS NOT NULL`
    );

    this.stmtAgentErrorRate = this.db.prepare(
      `SELECT
         COUNT(*) as total,
         COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as errors
       FROM usage_events
       WHERE agent_id = ? AND timestamp > ?`
    );

    // Tool stats
    this.stmtToolTotalCalls = this.db.prepare(
      `SELECT COUNT(*) as count FROM usage_events
       WHERE tool_name = ? AND timestamp > ?`
    );

    this.stmtToolTotalRevenue = this.db.prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) as total FROM usage_events
       WHERE tool_name = ? AND timestamp > ?`
    );

    this.stmtToolUniqueAgents = this.db.prepare(
      `SELECT COUNT(DISTINCT agent_id) as count FROM usage_events
       WHERE tool_name = ? AND timestamp > ?`
    );

    this.stmtToolAvgProcessingTime = this.db.prepare(
      `SELECT COALESCE(AVG(processing_time_ms), 0) as avg_time FROM usage_events
       WHERE tool_name = ? AND timestamp > ? AND processing_time_ms IS NOT NULL`
    );

    this.stmtToolErrorRate = this.db.prepare(
      `SELECT
         COUNT(*) as total,
         COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as errors
       FROM usage_events
       WHERE tool_name = ? AND timestamp > ?`
    );

    // Overview stats
    this.stmtOverviewTotalCalls = this.db.prepare(
      `SELECT COUNT(*) as count FROM usage_events WHERE timestamp > ?`
    );

    this.stmtOverviewTotalRevenue = this.db.prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) as total FROM usage_events WHERE timestamp > ?`
    );

    this.stmtOverviewUniqueAgents = this.db.prepare(
      `SELECT COUNT(DISTINCT agent_id) as count FROM usage_events WHERE timestamp > ?`
    );

    this.stmtOverviewCallsByTool = this.db.prepare(
      `SELECT tool_name, COUNT(*) as count FROM usage_events
       WHERE timestamp > ? GROUP BY tool_name`
    );

    this.stmtOverviewRevenueByTool = this.db.prepare(
      `SELECT tool_name, COALESCE(SUM(amount_usd), 0) as total FROM usage_events
       WHERE timestamp > ? GROUP BY tool_name`
    );

    this.stmtOverviewCallsByMethod = this.db.prepare(
      `SELECT payment_method, COUNT(*) as count FROM usage_events
       WHERE timestamp > ? GROUP BY payment_method`
    );

    this.stmtOverviewAvgProcessingTime = this.db.prepare(
      `SELECT COALESCE(AVG(processing_time_ms), 0) as avg_time FROM usage_events
       WHERE timestamp > ? AND processing_time_ms IS NOT NULL`
    );

    // Revenue stats
    this.stmtRevenueTotal = this.db.prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) as total FROM usage_events WHERE timestamp > ?`
    );

    this.stmtRevenueByTool = this.db.prepare(
      `SELECT tool_name, COALESCE(SUM(amount_usd), 0) as total FROM usage_events
       WHERE timestamp > ? GROUP BY tool_name`
    );

    this.stmtRevenueByMethod = this.db.prepare(
      `SELECT payment_method, COALESCE(SUM(amount_usd), 0) as total FROM usage_events
       WHERE timestamp > ? GROUP BY payment_method`
    );

    this.stmtRevenueByDay = this.db.prepare(
      `SELECT
         DATE(timestamp, 'unixepoch') as date,
         COALESCE(SUM(amount_usd), 0) as revenue
       FROM usage_events
       WHERE timestamp > ?
       GROUP BY DATE(timestamp, 'unixepoch')
       ORDER BY date`
    );
  }

  // --------------------------------------------------------------------------
  // RECORD USAGE
  // --------------------------------------------------------------------------

  /**
   * Record a tool usage event.
   * Fast synchronous insert — should not slow down tool execution.
   */
  record(event: UsageEvent): void {
    const now = Math.floor(Date.now() / 1000);
    this.stmtRecord.run(
      event.agentId,
      event.toolName,
      now,
      event.paymentMethod,
      event.amountUsd ?? 0,
      event.processingTimeMs ?? null,
      event.success !== false ? 1 : 0,
      event.errorMessage ?? null
    );
  }

  // --------------------------------------------------------------------------
  // RATE LIMITING
  // --------------------------------------------------------------------------

  /**
   * Check if an agent is within rate limits.
   * Uses sliding window counting against the database.
   * Returns whether the request is allowed and remaining quota.
   */
  checkRateLimit(agentId: string): RateLimitResult {
    const now = Math.floor(Date.now() / 1000);

    // Count calls in each window
    const minuteCount = (
      this.stmtCountWindow.get(agentId, now - 60) as { count: number }
    ).count;
    const hourCount = (
      this.stmtCountWindow.get(agentId, now - 3600) as { count: number }
    ).count;
    const dayCount = (
      this.stmtCountWindow.get(agentId, now - 86400) as { count: number }
    ).count;

    const remaining = {
      perMinute: Math.max(0, this.rateLimits.perMinute - minuteCount),
      perHour: Math.max(0, this.rateLimits.perHour - hourCount),
      perDay: Math.max(0, this.rateLimits.perDay - dayCount),
    };

    // Check each limit in order of strictness
    if (minuteCount >= this.rateLimits.perMinute) {
      return {
        allowed: false,
        limitExceeded: "per_minute",
        remaining,
        retryAfterSeconds: 60,
      };
    }

    if (hourCount >= this.rateLimits.perHour) {
      return {
        allowed: false,
        limitExceeded: "per_hour",
        remaining,
        retryAfterSeconds: 3600,
      };
    }

    if (dayCount >= this.rateLimits.perDay) {
      return {
        allowed: false,
        limitExceeded: "per_day",
        remaining,
        retryAfterSeconds: 86400,
      };
    }

    return { allowed: true, remaining };
  }

  // --------------------------------------------------------------------------
  // AGENT STATS
  // --------------------------------------------------------------------------

  /**
   * Get usage statistics for a specific agent.
   */
  getAgentStats(
    agentId: string,
    period: StatsPeriod = "day"
  ): AgentStats {
    const since = Math.floor(Date.now() / 1000) - periodToSeconds(period);

    const totalCalls = (
      this.stmtAgentTotalCalls.get(agentId, since) as { count: number }
    ).count;

    const totalRevenue = (
      this.stmtAgentTotalRevenue.get(agentId, since) as { total: number }
    ).total;

    const callsByToolRows = this.stmtAgentCallsByTool.all(agentId, since) as Array<{
      tool_name: string;
      count: number;
    }>;
    const callsByTool: Record<string, number> = {};
    for (const row of callsByToolRows) {
      callsByTool[row.tool_name] = row.count;
    }

    const avgProcessingTime = (
      this.stmtAgentAvgProcessingTime.get(agentId, since) as { avg_time: number }
    ).avg_time;

    const errorRow = this.stmtAgentErrorRate.get(agentId, since) as {
      total: number;
      errors: number;
    };
    const errorRate = errorRow.total > 0 ? errorRow.errors / errorRow.total : 0;

    return {
      agentId,
      totalCalls,
      totalRevenue,
      callsByTool,
      avgProcessingTime: Math.round(avgProcessingTime),
      errorRate,
      period,
    };
  }

  // --------------------------------------------------------------------------
  // TOOL STATS
  // --------------------------------------------------------------------------

  /**
   * Get usage statistics for a specific tool.
   */
  getToolStats(
    toolName: string,
    period: StatsPeriod = "day"
  ): ToolStats {
    const since = Math.floor(Date.now() / 1000) - periodToSeconds(period);

    const totalCalls = (
      this.stmtToolTotalCalls.get(toolName, since) as { count: number }
    ).count;

    const totalRevenue = (
      this.stmtToolTotalRevenue.get(toolName, since) as { total: number }
    ).total;

    const uniqueAgents = (
      this.stmtToolUniqueAgents.get(toolName, since) as { count: number }
    ).count;

    const avgProcessingTime = (
      this.stmtToolAvgProcessingTime.get(toolName, since) as { avg_time: number }
    ).avg_time;

    const errorRow = this.stmtToolErrorRate.get(toolName, since) as {
      total: number;
      errors: number;
    };
    const errorRate = errorRow.total > 0 ? errorRow.errors / errorRow.total : 0;

    return {
      toolName,
      totalCalls,
      totalRevenue,
      uniqueAgents,
      avgProcessingTime: Math.round(avgProcessingTime),
      errorRate,
      period,
    };
  }

  // --------------------------------------------------------------------------
  // OVERVIEW STATS
  // --------------------------------------------------------------------------

  /**
   * Get aggregated overview statistics across all agents and tools.
   */
  getOverviewStats(period: StatsPeriod = "day"): OverviewStats {
    const since = Math.floor(Date.now() / 1000) - periodToSeconds(period);

    const totalCalls = (
      this.stmtOverviewTotalCalls.get(since) as { count: number }
    ).count;

    const totalRevenue = (
      this.stmtOverviewTotalRevenue.get(since) as { total: number }
    ).total;

    const uniqueAgents = (
      this.stmtOverviewUniqueAgents.get(since) as { count: number }
    ).count;

    const callsByToolRows = this.stmtOverviewCallsByTool.all(since) as Array<{
      tool_name: string;
      count: number;
    }>;
    const callsByTool: Record<string, number> = {};
    for (const row of callsByToolRows) {
      callsByTool[row.tool_name] = row.count;
    }

    const revenueByToolRows = this.stmtOverviewRevenueByTool.all(since) as Array<{
      tool_name: string;
      total: number;
    }>;
    const revenueByTool: Record<string, number> = {};
    for (const row of revenueByToolRows) {
      revenueByTool[row.tool_name] = row.total;
    }

    const callsByMethodRows = this.stmtOverviewCallsByMethod.all(since) as Array<{
      payment_method: string;
      count: number;
    }>;
    const callsByMethod: Record<string, number> = {};
    for (const row of callsByMethodRows) {
      callsByMethod[row.payment_method] = row.count;
    }

    const avgProcessingTime = (
      this.stmtOverviewAvgProcessingTime.get(since) as { avg_time: number }
    ).avg_time;

    return {
      totalCalls,
      totalRevenue,
      uniqueAgents,
      callsByTool,
      revenueByTool,
      callsByMethod,
      avgProcessingTime: Math.round(avgProcessingTime),
      period,
    };
  }

  // --------------------------------------------------------------------------
  // REVENUE TRACKING
  // --------------------------------------------------------------------------

  /**
   * Get revenue breakdown statistics.
   */
  getRevenue(period: StatsPeriod = "day"): RevenueStats {
    const since = Math.floor(Date.now() / 1000) - periodToSeconds(period);

    const totalRevenue = (
      this.stmtRevenueTotal.get(since) as { total: number }
    ).total;

    const revenueByToolRows = this.stmtRevenueByTool.all(since) as Array<{
      tool_name: string;
      total: number;
    }>;
    const revenueByTool: Record<string, number> = {};
    for (const row of revenueByToolRows) {
      revenueByTool[row.tool_name] = row.total;
    }

    const revenueByMethodRows = this.stmtRevenueByMethod.all(since) as Array<{
      payment_method: string;
      total: number;
    }>;
    const revenueByMethod: Record<string, number> = {};
    for (const row of revenueByMethodRows) {
      revenueByMethod[row.payment_method] = row.total;
    }

    const revenueByDayRows = this.stmtRevenueByDay.all(since) as Array<{
      date: string;
      revenue: number;
    }>;

    return {
      totalRevenue,
      revenueByTool,
      revenueByMethod,
      revenueByDay: revenueByDayRows,
      period,
    };
  }

  // --------------------------------------------------------------------------
  // MAINTENANCE
  // --------------------------------------------------------------------------

  /**
   * Remove usage records older than the specified number of days.
   * Defaults to 90 days.
   * Returns the number of records removed.
   */
  cleanup(olderThanDays = 90): number {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    const result = this.stmtCleanup.run(cutoff);
    return result.changes;
  }

  // --------------------------------------------------------------------------
  // LIFECYCLE
  // --------------------------------------------------------------------------

  /**
   * Close the database connection.
   * Call this when shutting down the server.
   */
  close(): void {
    this.db.close();
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payment_method TEXT,
        amount_usd REAL DEFAULT 0,
        processing_time_ms INTEGER,
        success INTEGER DEFAULT 1,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_events(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_tool ON usage_events(tool_name, timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_events(timestamp);
    `);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a UsageMetering instance.
 * Convenience factory that accepts the same options as the constructor.
 */
export function createUsageMetering(options?: MeteringOptions): UsageMetering {
  return new UsageMetering(options);
}
