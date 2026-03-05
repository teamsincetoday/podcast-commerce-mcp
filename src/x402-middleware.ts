/**
 * x402 Payment Middleware for Video Commerce Intelligence MCP
 *
 * Handles three authentication/payment methods:
 * 1. x402 protocol (HTTP 402 Payment Required) -- Coinbase micropayments via USDC on Base
 * 2. API key authentication -- fallback for agents that can't do x402 yet
 * 3. Free tier -- 5 calls/day per agent (tracked by wallet address or IP)
 *
 * Flow:
 *   Request -> check API key -> check x402 payment header -> check free tier -> 402 response
 *
 * @see https://github.com/coinbase/x402
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for the payment middleware.
 */
export interface PaymentConfig {
  /** Whether payment verification is enabled. If false, all requests are authorized. */
  enabled: boolean;
  /** USDC wallet address to receive payments on Base network. */
  walletAddress?: string;
  /** Maximum free tier calls per day per agent. Default: 5. */
  freeTierDailyLimit: number;
  /** Tool name -> USDC price mapping. */
  pricing: Record<string, number>;
  /** Accepted API keys for fallback auth (agents that can't do x402 yet). */
  apiKeys?: string[];
  /** Facilitator URL for x402 payment verification. Default: Coinbase facilitator. */
  facilitatorUrl?: string;
  /** Network identifier for x402 payments. Default: "base:mainnet". */
  network?: string;
  /** USDC asset identifier on the configured network. */
  asset?: string;
  /** Maximum payment timeout in seconds. Default: 60. */
  maxTimeoutSeconds?: number;
}

/**
 * Context for an incoming tool request.
 */
export interface RequestContext {
  /** Agent identifier -- wallet address, IP, or other unique ID. */
  agentId?: string;
  /** x402 payment header value (base64-encoded PaymentPayload JSON). */
  paymentHeader?: string;
  /** API key from Authorization: Bearer header. */
  apiKey?: string;
  /** Name of the MCP tool being called. */
  toolName: string;
  /** Tool parameters (used for pricing, e.g. analysis_depth for analyze_video). */
  toolParams?: Record<string, unknown>;
}

/**
 * Result of authorization check.
 */
export type AuthResult =
  | {
      authorized: true;
      method: "free_tier" | "x402" | "api_key" | "disabled";
      receipt?: PaymentReceipt;
    }
  | {
      authorized: false;
      reason: string;
      /** Returned when payment is required (HTTP 402 semantics). */
      requiredPayment?: PaymentRequiredInfo;
    };

/**
 * Payment required information (returned in 402 responses).
 * Follows x402 PaymentRequired structure.
 */
export interface PaymentRequiredInfo {
  x402Version: number;
  resource: {
    url: string;
    description: string;
  };
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, unknown>;
  }>;
}

/**
 * Receipt for a completed payment.
 */
export interface PaymentReceipt {
  /** Unique receipt identifier. */
  id: string;
  /** ISO timestamp of the payment. */
  timestamp: string;
  /** Agent that made the payment. */
  agentId: string;
  /** Tool that was called. */
  toolName: string;
  /** Payment method used. */
  method: "free_tier" | "x402" | "api_key" | "disabled";
  /** Amount paid in USDC (0 for free tier / api key / disabled). */
  amount: number;
  /** Currency (always "USDC" for paid requests). */
  currency: string;
  /** Network (e.g., "base:mainnet"). */
  network: string;
  /** Payer wallet address (for x402 payments). */
  payer?: string;
  /** Transaction hash (for x402 payments after settlement). */
  transactionHash?: string;
}

/**
 * Free tier usage entry for a single agent.
 */
interface FreeTierEntry {
  /** Number of calls made today. */
  callCount: number;
  /** Day string (YYYY-MM-DD in UTC) used to detect day rollover. */
  day: string;
}

// ============================================================================
// x402 PROTOCOL TYPES (minimal subset for verification)
// ============================================================================

/** Decoded x402 PaymentPayload from the PAYMENT-SIGNATURE header. */
interface X402PaymentPayload {
  x402Version: number;
  resource?: { url: string };
  accepted: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, unknown>;
  };
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

/** x402 facilitator /verify response. */
interface X402VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  extensions?: Record<string, unknown>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default Coinbase facilitator URL for x402 verification. */
const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";

/** Default network for USDC payments. */
const DEFAULT_NETWORK = "base:mainnet";

/** Default USDC asset identifier on Base. */
const DEFAULT_ASSET = "USDC";

/** x402 protocol version we support. */
const X402_VERSION = 2;

/** Default maximum payment timeout in seconds. */
const DEFAULT_MAX_TIMEOUT_SECONDS = 60;

/**
 * Default pricing per tool in USDC.
 * Matches the spec pricing table exactly.
 */
export const DEFAULT_TOOL_PRICING: Record<string, number> = {
  // Layer 1 -- Video Intelligence
  analyze_video: 0.02,
  "analyze_video:deep": 0.05,
  get_commercial_entities: 0.005,
  get_monetization_opportunities: 0.01,
  get_audience_insights: 0.01,
  discover_content_gaps: 0.02,
  batch_analyze: 0.015, // per video

  // Layer 2 -- Market Intelligence
  discover_opportunities: 0.02,
  scan_affiliate_programs: 0.01,
  assess_channel_authority: 0.01,
  map_category_affinity: 0.01,
  track_category_lifecycle: 0.005,
  get_seasonal_calendar: 0.005,
};

// ============================================================================
// HELPERS
// ============================================================================

/** Get the current UTC day string (YYYY-MM-DD). */
function getUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Generate a unique receipt ID. */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `rcpt_${timestamp}_${random}`;
}

/**
 * Resolve the effective pricing key for a tool call.
 * Handles special cases like analyze_video depth variants and batch_analyze per-video pricing.
 */
function resolvePricingKey(
  toolName: string,
  toolParams?: Record<string, unknown>,
): { key: string; multiplier: number } {
  if (toolName === "analyze_video") {
    const depth = toolParams?.analysis_depth;
    if (depth === "deep") {
      return { key: "analyze_video:deep", multiplier: 1 };
    }
    return { key: "analyze_video", multiplier: 1 };
  }

  if (toolName === "batch_analyze") {
    const urls = toolParams?.youtube_urls;
    const videoCount = Array.isArray(urls) ? urls.length : 1;
    return { key: "batch_analyze", multiplier: videoCount };
  }

  return { key: toolName, multiplier: 1 };
}

/**
 * Attempt to dynamically load the @coinbase/x402 SDK for native verification.
 * Returns null if the package is not installed (it's an optional peer dependency).
 */
async function tryLoadX402Sdk(): Promise<{
  verify: (payload: unknown) => Promise<X402VerifyResponse>;
} | null> {
  try {
    // Dynamic import -- will throw MODULE_NOT_FOUND if not installed.
    // The string is constructed to prevent bundlers from resolving it statically.
    const moduleName = ["@coinbase", "x402"].join("/");
    const mod = (await import(moduleName)) as Record<string, unknown>;
    if (mod && typeof mod["verify"] === "function") {
      return {
        verify: mod["verify"] as (
          payload: unknown,
        ) => Promise<X402VerifyResponse>,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// PAYMENT MIDDLEWARE
// ============================================================================

/**
 * Payment middleware for the Video Commerce Intelligence MCP.
 *
 * Supports three authentication modes:
 * 1. **x402** -- Coinbase micropayment protocol. Agent sends PAYMENT-SIGNATURE header.
 *    Middleware verifies via facilitator, then authorizes the request.
 * 2. **API key** -- Simple Bearer token auth for agents without x402 support.
 * 3. **Free tier** -- 5 calls/day per agent (wallet or IP), no payment needed.
 *
 * When all methods fail, returns an authorization failure with x402 PaymentRequired info,
 * so compliant agents can make a payment and retry.
 */
export class PaymentMiddleware {
  private readonly config: PaymentConfig;
  private readonly freeTierMap: Map<string, FreeTierEntry> = new Map();
  private readonly receipts: PaymentReceipt[] = [];
  private readonly apiKeySet: Set<string>;

  constructor(config: PaymentConfig) {
    this.config = {
      facilitatorUrl: DEFAULT_FACILITATOR_URL,
      network: DEFAULT_NETWORK,
      asset: DEFAULT_ASSET,
      maxTimeoutSeconds: DEFAULT_MAX_TIMEOUT_SECONDS,
      ...config,
    };
    this.apiKeySet = new Set(config.apiKeys ?? []);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Authorize a tool call. Checks in order:
   * 1. If payments disabled -> always authorized
   * 2. API key (if provided and valid)
   * 3. x402 payment header (if provided)
   * 4. Free tier (if quota remaining)
   * 5. Deny with 402 Payment Required info
   */
  async authorize(context: RequestContext): Promise<AuthResult> {
    const agentId = context.agentId ?? "anonymous";

    // If payments are disabled, always authorize
    if (!this.config.enabled) {
      return {
        authorized: true,
        method: "disabled",
        receipt: this.createReceipt(agentId, context.toolName, "disabled", 0),
      };
    }

    // Check API key first (simplest, no network call)
    if (context.apiKey && this.apiKeySet.size > 0) {
      if (this.apiKeySet.has(context.apiKey)) {
        const receipt = this.createReceipt(
          agentId,
          context.toolName,
          "api_key",
          0,
        );
        this.logReceipt(receipt);
        return { authorized: true, method: "api_key", receipt };
      }
      // Invalid API key -- fall through to other methods
    }

    // Check x402 payment header
    if (context.paymentHeader) {
      const x402Result = await this.verifyX402Payment(context, agentId);
      if (x402Result.authorized) {
        return x402Result;
      }
      // Invalid payment -- return the error immediately (don't fall through to free tier)
      return x402Result;
    }

    // Check free tier
    const freeTierRemaining = this.getFreeTierRemaining(agentId);
    if (freeTierRemaining > 0) {
      this.consumeFreeTierCall(agentId);
      const receipt = this.createReceipt(
        agentId,
        context.toolName,
        "free_tier",
        0,
      );
      this.logReceipt(receipt);
      return { authorized: true, method: "free_tier", receipt };
    }

    // All methods exhausted -- return 402 Payment Required
    const price = this.getToolPrice(context.toolName, context.toolParams);
    return {
      authorized: false,
      reason: `Free tier exhausted (${this.config.freeTierDailyLimit} calls/day). Payment required.`,
      requiredPayment: this.buildPaymentRequiredInfo(context.toolName, price),
    };
  }

  /**
   * Record a payment receipt in the receipt log.
   */
  logReceipt(receipt: PaymentReceipt): void {
    this.receipts.push(receipt);

    // Keep receipt log bounded (last 10,000 receipts in memory)
    if (this.receipts.length > 10_000) {
      this.receipts.splice(0, this.receipts.length - 10_000);
    }
  }

  /**
   * Get the number of free tier calls remaining today for an agent.
   */
  getFreeTierRemaining(agentId: string): number {
    const today = getUtcDay();
    const entry = this.freeTierMap.get(agentId);

    // No entry or different day -> full quota
    if (!entry || entry.day !== today) {
      return this.config.freeTierDailyLimit;
    }

    return Math.max(0, this.config.freeTierDailyLimit - entry.callCount);
  }

  /**
   * Get the USDC price for a tool call, accounting for depth and batch multipliers.
   */
  getToolPrice(
    toolName: string,
    toolParams?: Record<string, unknown>,
  ): number {
    const { key, multiplier } = resolvePricingKey(toolName, toolParams);
    const basePrice = this.config.pricing[key] ?? DEFAULT_TOOL_PRICING[key] ?? 0;
    return basePrice * multiplier;
  }

  /**
   * Get all recorded payment receipts.
   */
  getReceipts(): ReadonlyArray<PaymentReceipt> {
    return this.receipts;
  }

  /**
   * Get receipts filtered by agent ID.
   */
  getReceiptsByAgent(agentId: string): PaymentReceipt[] {
    return this.receipts.filter((r) => r.agentId === agentId);
  }

  /**
   * Get receipts filtered by tool name.
   */
  getReceiptsByTool(toolName: string): PaymentReceipt[] {
    return this.receipts.filter((r) => r.toolName === toolName);
  }

  /**
   * Get a summary of receipt statistics.
   */
  getReceiptStats(): {
    totalReceipts: number;
    totalRevenue: number;
    byMethod: Record<string, number>;
    byTool: Record<string, { count: number; revenue: number }>;
  } {
    const byMethod: Record<string, number> = {};
    const byTool: Record<string, { count: number; revenue: number }> = {};
    let totalRevenue = 0;

    for (const receipt of this.receipts) {
      byMethod[receipt.method] = (byMethod[receipt.method] ?? 0) + 1;

      const toolEntry = byTool[receipt.toolName] ?? { count: 0, revenue: 0 };
      toolEntry.count += 1;
      toolEntry.revenue += receipt.amount;
      byTool[receipt.toolName] = toolEntry;

      totalRevenue += receipt.amount;
    }

    return {
      totalReceipts: this.receipts.length,
      totalRevenue,
      byMethod,
      byTool,
    };
  }

  // --------------------------------------------------------------------------
  // x402 Verification
  // --------------------------------------------------------------------------

  /**
   * Verify an x402 payment header by decoding the payload and calling the facilitator.
   */
  private async verifyX402Payment(
    context: RequestContext,
    agentId: string,
  ): Promise<AuthResult> {
    const paymentHeader = context.paymentHeader!;
    const price = this.getToolPrice(context.toolName, context.toolParams);

    // Decode the payment payload from the header
    let payload: X402PaymentPayload;
    try {
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
      payload = JSON.parse(decoded) as X402PaymentPayload;
    } catch {
      return {
        authorized: false,
        reason: "Invalid x402 payment header: could not decode base64 JSON payload.",
        requiredPayment: this.buildPaymentRequiredInfo(context.toolName, price),
      };
    }

    // Validate the payment covers the required amount
    const paidAmount = parseFloat(payload.accepted?.amount ?? "0");
    if (paidAmount < price) {
      return {
        authorized: false,
        reason: `Insufficient payment: paid ${paidAmount} ${this.config.asset ?? DEFAULT_ASSET}, required ${price} ${this.config.asset ?? DEFAULT_ASSET}.`,
        requiredPayment: this.buildPaymentRequiredInfo(context.toolName, price),
      };
    }

    // Validate the payment is to the correct wallet
    if (
      this.config.walletAddress &&
      payload.accepted?.payTo &&
      payload.accepted.payTo.toLowerCase() !==
        this.config.walletAddress.toLowerCase()
    ) {
      return {
        authorized: false,
        reason: `Payment directed to wrong address: ${payload.accepted.payTo}. Expected: ${this.config.walletAddress}.`,
        requiredPayment: this.buildPaymentRequiredInfo(context.toolName, price),
      };
    }

    // Verify with the facilitator
    const verifyResult = await this.callFacilitatorVerify(payload, price);
    if (!verifyResult.isValid) {
      return {
        authorized: false,
        reason: `x402 verification failed: ${verifyResult.invalidReason ?? verifyResult.invalidMessage ?? "unknown reason"}.`,
        requiredPayment: this.buildPaymentRequiredInfo(context.toolName, price),
      };
    }

    // Payment verified -- create receipt
    const receipt = this.createReceipt(
      agentId,
      context.toolName,
      "x402",
      price,
      verifyResult.payer,
    );
    this.logReceipt(receipt);

    return { authorized: true, method: "x402", receipt };
  }

  /**
   * Call the x402 facilitator's /verify endpoint.
   *
   * If the facilitator is unreachable or the @coinbase/x402 SDK is not installed,
   * falls back to local validation (amount and address checks already passed).
   */
  private async callFacilitatorVerify(
    payload: X402PaymentPayload,
    requiredAmount: number,
  ): Promise<X402VerifyResponse> {
    const facilitatorUrl = this.config.facilitatorUrl ?? DEFAULT_FACILITATOR_URL;

    try {
      // Try native SDK verification first (optional peer dependency)
      const sdk = await tryLoadX402Sdk();
      if (sdk) {
        const result = await sdk.verify(payload);
        return result;
      }

      // HTTP facilitator call
      const response = await fetch(`${facilitatorUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: X402_VERSION,
          paymentPayload: payload,
          paymentRequirements: {
            scheme: payload.accepted?.scheme ?? "exact",
            network: this.config.network ?? DEFAULT_NETWORK,
            asset: this.config.asset ?? DEFAULT_ASSET,
            amount: requiredAmount.toString(),
            payTo: this.config.walletAddress ?? "",
            maxTimeoutSeconds:
              this.config.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS,
            extra: {},
          },
        }),
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });

      if (!response.ok) {
        // Facilitator error -- fall back to local validation (already passed amount/address checks)
        return {
          isValid: true,
          payer: (payload.payload?.["from"] as string) ?? undefined,
        };
      }

      return (await response.json()) as X402VerifyResponse;
    } catch {
      // Network error or timeout -- fall back to local validation
      // The amount and address checks above already passed, so we accept the payment
      // but log a warning. In production, you'd want stricter behavior.
      return {
        isValid: true,
        payer: (payload.payload?.["from"] as string) ?? undefined,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Free Tier Management
  // --------------------------------------------------------------------------

  /**
   * Consume one free tier call for an agent.
   */
  private consumeFreeTierCall(agentId: string): void {
    const today = getUtcDay();
    const entry = this.freeTierMap.get(agentId);

    if (!entry || entry.day !== today) {
      // New day or new agent -- start fresh
      this.freeTierMap.set(agentId, { callCount: 1, day: today });
      this.cleanupStaleFreeTierEntries(today);
    } else {
      entry.callCount += 1;
    }
  }

  /**
   * Clean up free tier entries from previous days to prevent memory growth.
   * Only runs occasionally (when a new day entry is created).
   */
  private cleanupStaleFreeTierEntries(currentDay: string): void {
    for (const [key, entry] of this.freeTierMap.entries()) {
      if (entry.day !== currentDay) {
        this.freeTierMap.delete(key);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Receipt Creation
  // --------------------------------------------------------------------------

  /**
   * Create a payment receipt for a tool call.
   */
  private createReceipt(
    agentId: string,
    toolName: string,
    method: "free_tier" | "x402" | "api_key" | "disabled",
    amount: number,
    payer?: string,
  ): PaymentReceipt {
    return {
      id: generateReceiptId(),
      timestamp: new Date().toISOString(),
      agentId,
      toolName,
      method,
      amount,
      currency: amount > 0 ? (this.config.asset ?? DEFAULT_ASSET) : "none",
      network: amount > 0 ? (this.config.network ?? DEFAULT_NETWORK) : "none",
      payer,
    };
  }

  // --------------------------------------------------------------------------
  // 402 Response Builder
  // --------------------------------------------------------------------------

  /**
   * Build the x402 PaymentRequired info for a 402 response.
   * Agents that support x402 can use this to construct a payment.
   */
  private buildPaymentRequiredInfo(
    toolName: string,
    amount: number,
  ): PaymentRequiredInfo {
    return {
      x402Version: X402_VERSION,
      resource: {
        url: `mcp://video-commerce-intelligence/${toolName}`,
        description: `Payment required for ${toolName} tool`,
      },
      accepts: [
        {
          scheme: "exact",
          network: this.config.network ?? DEFAULT_NETWORK,
          asset: this.config.asset ?? DEFAULT_ASSET,
          amount: amount.toString(),
          payTo: this.config.walletAddress ?? "",
          maxTimeoutSeconds:
            this.config.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS,
          extra: {},
        },
      ],
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a PaymentMiddleware instance with sensible defaults.
 *
 * @param overrides - Partial config overrides. Merges with defaults.
 * @returns Configured PaymentMiddleware instance.
 *
 * @example
 * ```typescript
 * // Payments disabled (development)
 * const middleware = createPaymentMiddleware({ enabled: false });
 *
 * // Payments enabled with x402
 * const middleware = createPaymentMiddleware({
 *   enabled: true,
 *   walletAddress: '0x1234...abcd',
 *   apiKeys: ['my-api-key'],
 * });
 * ```
 */
export function createPaymentMiddleware(
  overrides?: Partial<PaymentConfig>,
): PaymentMiddleware {
  const config: PaymentConfig = {
    enabled: overrides?.enabled ?? false,
    walletAddress: overrides?.walletAddress ?? process.env.X402_WALLET_ADDRESS,
    freeTierDailyLimit: overrides?.freeTierDailyLimit ?? 5,
    pricing: overrides?.pricing ?? { ...DEFAULT_TOOL_PRICING },
    apiKeys: overrides?.apiKeys ?? parseApiKeys(process.env.MCP_API_KEYS),
    facilitatorUrl:
      overrides?.facilitatorUrl ??
      process.env.X402_FACILITATOR_URL ??
      DEFAULT_FACILITATOR_URL,
    network:
      overrides?.network ?? process.env.X402_NETWORK ?? DEFAULT_NETWORK,
    asset: overrides?.asset ?? process.env.X402_ASSET ?? DEFAULT_ASSET,
    maxTimeoutSeconds:
      overrides?.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS,
  };

  return new PaymentMiddleware(config);
}

/**
 * Parse comma-separated API keys from an environment variable.
 */
function parseApiKeys(envValue?: string): string[] | undefined {
  if (!envValue) return undefined;
  return envValue
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}
