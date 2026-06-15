/**
 * Pricing extraction and cost estimation helpers.
 *
 * Extracts pricing metadata from VS Code LanguageModelChat objects and
 * calculates estimated USD costs from token usage counts.
 *
 * Pricing rule:
 *   inputCost, outputCost, cacheCost are AICs (AI Credits) per 1M tokens.
 *   USD per 1M tokens = AIC value / 100.
 */

/** Extracted pricing info for a single model. */
export interface ModelPricingInfo {
  /** Input cost in AICs per 1M tokens, if available. */
  inputAicPer1M: number | undefined;
  /** Output cost in AICs per 1M tokens, if available. */
  outputAicPer1M: number | undefined;
  /** Cached input cost in AICs per 1M tokens, if available. */
  cacheAicPer1M: number | undefined;
  /** Input cost in USD per 1M tokens, if available. */
  inputUsdPer1M: number | undefined;
  /** Output cost in USD per 1M tokens, if available. */
  outputUsdPer1M: number | undefined;
  /** Cached input cost in USD per 1M tokens, if available. */
  cacheUsdPer1M: number | undefined;
  /** Price category string (e.g. "medium"), if available. */
  priceCategory: string | undefined;
  /** Raw pricing string from metadata, if available. */
  rawPricing: string | undefined;
}

/** Result of a cost calculation for a single request. */
export interface CostEstimate {
  /** Estimated input (prompt) cost in USD. */
  inputCostUsd: number;
  /** Estimated output (completion) cost in USD. */
  outputCostUsd: number;
  /** Estimated total cost in USD. */
  totalCostUsd: number;
  /** Whether pricing metadata was available for this calculation. */
  pricingAvailable: boolean;
}

/**
 * Extract pricing information from a raw model object.
 *
 * Reads `inputCost`, `outputCost`, `cacheCost`, `priceCategory`, and `pricing`
 * fields from the model's raw metadata. Returns null if none of the numeric
 * cost fields are present.
 *
 * @param rawModel A VS Code LanguageModelChat object (or any object with pricing fields).
 * @returns A ModelPricingInfo object, or null if no pricing metadata exists.
 */
export function extractPricingFromModel(rawModel: any): ModelPricingInfo | null {
  if (!rawModel || typeof rawModel !== 'object') {
    return null;
  }

  const inputCost = typeof rawModel.inputCost === 'number' ? rawModel.inputCost : undefined;
  const outputCost = typeof rawModel.outputCost === 'number' ? rawModel.outputCost : undefined;
  const cacheCost = typeof rawModel.cacheCost === 'number' ? rawModel.cacheCost : undefined;

  // If no numeric cost fields exist, there is no usable pricing data.
  if (inputCost === undefined && outputCost === undefined && cacheCost === undefined) {
    return null;
  }

  return {
    inputAicPer1M: inputCost,
    outputAicPer1M: outputCost,
    cacheAicPer1M: cacheCost,
    inputUsdPer1M: inputCost !== undefined ? inputCost / 100 : undefined,
    outputUsdPer1M: outputCost !== undefined ? outputCost / 100 : undefined,
    cacheUsdPer1M: cacheCost !== undefined ? cacheCost / 100 : undefined,
    priceCategory: typeof rawModel.priceCategory === 'string' ? rawModel.priceCategory : undefined,
    rawPricing: typeof rawModel.pricing === 'string' ? rawModel.pricing : undefined,
  };
}

/**
 * Calculate estimated USD cost for a request given pricing info and token counts.
 *
 * Uses the formula:
 *   inputCostUsd  = promptTokens     / 1_000_000 * inputUsdPer1M
 *   outputCostUsd = completionTokens  / 1_000_000 * outputUsdPer1M
 *   totalCostUsd  = inputCostUsd + outputCostUsd
 *
 * Returns zeros with `pricingAvailable: false` if pricing is null.
 *
 * @param pricing  Model pricing info, or null if unavailable.
 * @param promptTokens  Number of prompt (input) tokens, or null.
 * @param completionTokens  Number of completion (output) tokens, or null.
 * @returns A CostEstimate with USD values and availability flag.
 */
export function calculateCost(
  pricing: ModelPricingInfo | null,
  promptTokens: number | null,
  completionTokens: number | null
): CostEstimate {
  if (!pricing) {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, pricingAvailable: false };
  }

  let inputCostUsd = 0;
  let outputCostUsd = 0;

  if (promptTokens != null && promptTokens > 0 && pricing.inputUsdPer1M != null) {
    inputCostUsd = promptTokens / 1_000_000 * pricing.inputUsdPer1M;
  }

  if (completionTokens != null && completionTokens > 0 && pricing.outputUsdPer1M != null) {
    outputCostUsd = completionTokens / 1_000_000 * pricing.outputUsdPer1M;
  }

  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    pricingAvailable: true,
  };
}

/**
 * Format a USD cost value for display.
 *
 * - Values of exactly 0 show as "$0.00".
 * - Values below $0.01 show 6 decimal places.
 * - Values below $1.00 show 4 decimal places.
 * - Values >= $1.00 show 2 decimal places.
 */
export function formatCostUsd(amount: number): string {
  if (amount === 0) { return '$0.00'; }
  if (amount < 0.01) { return '$' + amount.toFixed(6); }
  if (amount < 1) { return '$' + amount.toFixed(4); }
  return '$' + amount.toFixed(2);
}
