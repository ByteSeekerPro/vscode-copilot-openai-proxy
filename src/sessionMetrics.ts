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
  success: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  streaming: boolean | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  error: string | null;
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
  lastErrorSummary: string | null;
  modelMetrics: ModelMetrics[];
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
  private lastErrorSummary: string | null = null;
  private readonly modelMap = new Map<string, ModelMetrics>();

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

    if (entry.model) {
      this.lastUsedModel = entry.model;
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
      lastErrorSummary: this.lastErrorSummary,
      modelMetrics,
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
    this.lastErrorSummary = null;
    this.modelMap.clear();
  }

  private updateModelMetrics(entry: SessionRequestRecord): void {
    const modelId = entry.model!;
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
      };
      this.modelMap.set(modelId, mm);
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
