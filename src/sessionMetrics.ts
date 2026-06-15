/**
 * In-memory session metrics store.
 *
 * Tracks cumulative request metrics for the current VS Code session since
 * extension activation. Metrics are NOT persisted across restarts.
 * This is independent from the persistent CallHistoryStore.
 */

/** Fields recorded for each proxied request. */
export interface SessionRequestRecord {
  timestamp: string;
  endpoint: string;
  method: string;
  model: string | null;
  /** The model ID from the request body (e.g. "auto"), or null. */
  requestedModel?: string | null;
  /** The effective/concrete model ID resolved by the bridge, or null. */
  effectiveModel?: string | null;
  success: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  streaming: boolean | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  error: string | null;
  /** Effective model ID resolved by LmBridge (may differ from requested model). */
  effectiveModelId?: string | null;
  /** Estimated input cost in USD, or null if pricing unavailable. */
  estimatedInputCostUsd?: number | null;
  /** Estimated output cost in USD, or null if pricing unavailable. */
  estimatedOutputCostUsd?: number | null;
  /** Estimated total cost in USD, or null if pricing unavailable. */
  estimatedTotalCostUsd?: number | null;
  /** Model ID used for pricing lookup. */
  pricingModel?: string | null;
  /** Whether pricing was available for this request. */
  pricingAvailable?: boolean;
  /** Input USD per 1M tokens rate used for this request, or null. */
  inputUsdPer1M?: number | null;
  /** Output USD per 1M tokens rate used for this request, or null. */
  outputUsdPer1M?: number | null;
}

/** Per-model aggregated metrics. */
export interface ModelMetrics {
  modelId: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencySum: number;
  latencyCount: number;
  /** Cumulative estimated input cost in USD. */
  inputCostUsd: number;
  /** Cumulative estimated output cost in USD. */
  outputCostUsd: number;
  /** Cumulative estimated total cost in USD. */
  totalCostUsd: number;
  /** Number of requests where pricing was unavailable. */
  unknownPricingRequests: number;
  /** Input USD per 1M tokens rate used, or null if unavailable. */
  inputUsdPer1M: number | null;
  /** Output USD per 1M tokens rate used, or null if unavailable. */
  outputUsdPer1M: number | null;
  /** Set of distinct requested model IDs that were resolved to this effective model. */
  requestedAs: string[];
}

/** Full session metrics snapshot sent to the webview. */
export interface SessionMetricsSnapshot {
  sessionStarted: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  modelsEndpointCount: number;
  chatCompletionsEndpointCount: number;
  streamingRequestCount: number;
  nonStreamingRequestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  averageLatencyMs: number;
  lastRequestTimestamp: string | null;
  lastUsedModel: string | null;
  /** Last effective (resolved) model ID, or null. */
  lastEffectiveModel: string | null;
  /** Last requested model ID (from request body), or null. */
  lastRequestedModel: string | null;
  lastErrorSummary: string | null;
  modelMetrics: ModelMetrics[];
  /** Cumulative estimated input cost in USD across all models. */
  totalInputCostUsd: number;
  /** Cumulative estimated output cost in USD across all models. */
  totalOutputCostUsd: number;
  /** Cumulative estimated total cost in USD across all models. */
  totalEstimatedCostUsd: number;
  /** Number of requests where pricing was unavailable. */
  unknownPricingRequests: number;
  /** Estimated cost of the last request in USD, or null. */
  lastRequestCostUsd: number | null;
  /** Model ID used for pricing of the last request, or null. */
  lastPricingModel: string | null;
}

export class SessionMetricsStore {
  private readonly sessionStarted: string = new Date().toISOString();
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private modelsEndpointCount = 0;
  private chatCompletionsEndpointCount = 0;
  private streamingRequestCount = 0;
  private nonStreamingRequestCount = 0;
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;
  private totalTokens = 0;
  private latencySum = 0;
  private latencyCount = 0;
  private lastRequestTimestamp: string | null = null;
  private lastUsedModel: string | null = null;
  private lastEffectiveModel: string | null = null;
  private lastRequestedModel: string | null = null;
  private lastErrorSummary: string | null = null;
  private readonly modelMap = new Map<string, ModelMetrics>();
  private totalInputCostUsd = 0;
  private totalOutputCostUsd = 0;
  private totalEstimatedCostUsd = 0;
  private unknownPricingRequests = 0;
  private lastRequestCostUsd: number | null = null;
  private lastPricingModel: string | null = null;

  /** Record a single proxied request into the session metrics. */
  record(entry: SessionRequestRecord): void {
    this.totalRequests++;

    if (entry.success) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
      if (entry.error) {
        this.lastErrorSummary = entry.error.length > 120
          ? entry.error.slice(0, 120) + '...'
          : entry.error;
      }
    }

    if (entry.endpoint === '/v1/models') {
      this.modelsEndpointCount++;
    } else if (entry.endpoint === '/v1/chat/completions') {
      this.chatCompletionsEndpointCount++;
    }

    if (entry.streaming === true) {
      this.streamingRequestCount++;
    } else if (entry.streaming === false) {
      this.nonStreamingRequestCount++;
    }

    if (entry.promptTokens != null) {
      this.totalPromptTokens += entry.promptTokens;
    }
    if (entry.completionTokens != null) {
      this.totalCompletionTokens += entry.completionTokens;
    }
    if (entry.totalTokens != null) {
      this.totalTokens += entry.totalTokens;
    }

    if (entry.latencyMs != null) {
      this.latencySum += entry.latencyMs;
      this.latencyCount++;
    }

    this.lastRequestTimestamp = entry.timestamp;

    // Accumulate cost data.
    if (entry.pricingAvailable === true) {
      if (entry.estimatedInputCostUsd != null) {
        this.totalInputCostUsd += entry.estimatedInputCostUsd;
      }
      if (entry.estimatedOutputCostUsd != null) {
        this.totalOutputCostUsd += entry.estimatedOutputCostUsd;
      }
      if (entry.estimatedTotalCostUsd != null) {
        this.totalEstimatedCostUsd += entry.estimatedTotalCostUsd;
        this.lastRequestCostUsd = entry.estimatedTotalCostUsd;
      }
      if (entry.pricingModel) {
        this.lastPricingModel = entry.pricingModel;
      }
    } else if (entry.pricingAvailable === false) {
      this.unknownPricingRequests++;
      this.lastRequestCostUsd = null;
      this.lastPricingModel = null;
    }

    // Track last model info — prefer effective model for display.
    if (entry.model) {
      this.lastUsedModel = entry.model;
    }
    this.lastRequestedModel = entry.requestedModel ?? entry.model ?? null;
    this.lastEffectiveModel = entry.effectiveModel ?? null;

    // Use the effective model for per-model bucketing when available,
    // so costs aggregate under the concrete model, not "auto".
    if (entry.effectiveModel || entry.model) {
      this.updateModelMetrics(entry);
    }
  }

  /** Get a serializable snapshot of all current session metrics. */
  getSnapshot(): SessionMetricsSnapshot {
    const modelMetrics: ModelMetrics[] = [];
    for (const m of this.modelMap.values()) {
      modelMetrics.push({ ...m });
    }

    return {
      sessionStarted: this.sessionStarted,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      modelsEndpointCount: this.modelsEndpointCount,
      chatCompletionsEndpointCount: this.chatCompletionsEndpointCount,
      streamingRequestCount: this.streamingRequestCount,
      nonStreamingRequestCount: this.nonStreamingRequestCount,
      totalPromptTokens: this.totalPromptTokens,
      totalCompletionTokens: this.totalCompletionTokens,
      totalTokens: this.totalTokens,
      averageLatencyMs: this.latencyCount > 0
        ? Math.round(this.latencySum / this.latencyCount)
        : 0,
      lastRequestTimestamp: this.lastRequestTimestamp,
      lastUsedModel: this.lastUsedModel,
      lastEffectiveModel: this.lastEffectiveModel,
      lastRequestedModel: this.lastRequestedModel,
      lastErrorSummary: this.lastErrorSummary,
      modelMetrics,
      totalInputCostUsd: this.totalInputCostUsd,
      totalOutputCostUsd: this.totalOutputCostUsd,
      totalEstimatedCostUsd: this.totalEstimatedCostUsd,
      unknownPricingRequests: this.unknownPricingRequests,
      lastRequestCostUsd: this.lastRequestCostUsd,
      lastPricingModel: this.lastPricingModel,
    };
  }

  /** Reset all in-memory session metrics (does not affect persistent call history). */
  reset(): void {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.modelsEndpointCount = 0;
    this.chatCompletionsEndpointCount = 0;
    this.streamingRequestCount = 0;
    this.nonStreamingRequestCount = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalTokens = 0;
    this.latencySum = 0;
    this.latencyCount = 0;
    this.lastRequestTimestamp = null;
    this.lastUsedModel = null;
    this.lastEffectiveModel = null;
    this.lastRequestedModel = null;
    this.lastErrorSummary = null;
    this.modelMap.clear();
    this.totalInputCostUsd = 0;
    this.totalOutputCostUsd = 0;
    this.totalEstimatedCostUsd = 0;
    this.unknownPricingRequests = 0;
    this.lastRequestCostUsd = null;
    this.lastPricingModel = null;
  }

  private updateModelMetrics(entry: SessionRequestRecord): void {
    // Use effective model for bucketing when available, so costs aggregate
    // under the concrete model (e.g. "gpt-5.3-codex") rather than "auto".
    const modelId = entry.effectiveModel || entry.model!;
    let mm = this.modelMap.get(modelId);
    if (!mm) {
      mm = {
        modelId,
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencySum: 0,
        latencyCount: 0,
        inputCostUsd: 0,
        outputCostUsd: 0,
        totalCostUsd: 0,
        unknownPricingRequests: 0,
        inputUsdPer1M: null,
        outputUsdPer1M: null,
        requestedAs: [],
      };
      this.modelMap.set(modelId, mm);
    }

    // Track which requested model IDs map to this effective model bucket.
    const requestedModel = entry.requestedModel ?? entry.model;
    if (requestedModel && !mm.requestedAs.includes(requestedModel)) {
      mm.requestedAs.push(requestedModel);
    }

    mm.requestCount++;
    if (entry.success) {
      mm.successCount++;
    } else {
      mm.failureCount++;
    }
    if (entry.promptTokens != null) {
      mm.promptTokens += entry.promptTokens;
    }
    if (entry.completionTokens != null) {
      mm.completionTokens += entry.completionTokens;
    }
    if (entry.totalTokens != null) {
      mm.totalTokens += entry.totalTokens;
    }
    if (entry.latencyMs != null) {
      mm.latencySum += entry.latencyMs;
      mm.latencyCount++;
    }
    // Accumulate per-model cost.
    if (entry.pricingAvailable === true) {
      if (entry.estimatedInputCostUsd != null) {
        mm.inputCostUsd += entry.estimatedInputCostUsd;
      }
      if (entry.estimatedOutputCostUsd != null) {
        mm.outputCostUsd += entry.estimatedOutputCostUsd;
      }
      if (entry.estimatedTotalCostUsd != null) {
        mm.totalCostUsd += entry.estimatedTotalCostUsd;
      }
      // Store rates from the first pricing-available entry.
      if (mm.inputUsdPer1M == null && entry.inputUsdPer1M != null) {
        mm.inputUsdPer1M = entry.inputUsdPer1M;
      }
      if (mm.outputUsdPer1M == null && entry.outputUsdPer1M != null) {
        mm.outputUsdPer1M = entry.outputUsdPer1M;
      }
    } else if (entry.pricingAvailable === false) {
      mm.unknownPricingRequests++;
    }
  }
}

/**
 * Safely serialize any value to a JSON-compatible representation.
 * Handles circular references, functions, symbols, undefined, and non-plain objects.
 */
export function safeSerialize(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return value;
  }

  if (t === 'function') {
    return '[Function]';
  }

  if (t === 'symbol') {
    return (value as symbol).toString();
  }

  if (t === 'bigint') {
    return (value as bigint).toString() + 'n';
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    return value.map((item) => safeSerialize(item, seen));
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) {
      return '[Circular]';
    }
    seen.add(obj);

    const result: Record<string, unknown> = {};
    try {
      for (const key of Object.keys(obj)) {
        // Redact sensitive-looking field values
        if (isSensitiveKey(key)) {
          result[key] = '[redacted]';
        } else {
          result[key] = safeSerialize(obj[key], seen);
        }
      }
    } catch {
      // Some objects may throw on Object.keys
      return '[Unserializable]';
    }
    return result;
  }

  return String(value);
}

/** Check if a key name looks sensitive (tokens, secrets, auth, etc.). */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower === 'token' ||
    lower === 'secret' ||
    lower === 'authorization' ||
    lower === 'password' ||
    lower === 'apikey' ||
    lower === 'api_key' ||
    lower === 'accesstoken' ||
    lower === 'access_token' ||
    lower === 'refreshtoken' ||
    lower === 'refresh_token' ||
    lower === 'bearer' ||
    lower === 'credential' ||
    lower === 'credentials' ||
    lower.includes('secret') ||
    (lower.includes('token') && lower !== 'prompttokens' && lower !== 'completiontokens' && lower !== 'totaltokens' && lower !== 'tokencount' && lower !== 'maxinputtokens') ||
    (lower.includes('password')) ||
    (lower.includes('authorization') && lower !== 'authorizationheader')
  );
}
