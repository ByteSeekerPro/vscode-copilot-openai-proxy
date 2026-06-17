// ---------------------------------------------------------------------------
// Tool request validation, tool_choice classification, and safe diagnostics
// ---------------------------------------------------------------------------

/**
 * Classify the tool_choice value from an OpenAI-compatible request.
 *
 * Returns a category string:
 *   - "missing"    — tool_choice was not provided (undefined/null)
 *   - "auto"       — model decides whether to call a tool
 *   - "none"       — model must NOT call any tool
 *   - "required"   — model MUST call at least one tool
 *   - "function:<name>" — model must call the specific function
 *   - "unsupported" — tool_choice value is not recognized
 */

/** Tool choice policy values controlling how unenforceable tool_choice is handled. */
export type ToolChoicePolicy = 'bestEffort' | 'strictPreflight' | 'strictAfterResponse';

/**
 * Returns true when the classified tool_choice requires a tool call
 * (i.e. "required" or "function:<name>").
 */
export function isToolChoiceRequired(classifiedToolChoice: string): boolean {
  return classifiedToolChoice === 'required' || classifiedToolChoice.startsWith('function:');
}

/**
 * Build an OpenAI-compatible error for strictPreflight rejection.
 * Returned when tool_choice requires enforcement but the bridge cannot enforce it.
 */
export function buildToolChoiceNotEnforceableError(): Record<string, unknown> {
  return {
    error: {
      message: 'tool_choice requires a tool call, but this bridge cannot enforce tool_choice through the VS Code Language Model API.',
      type: 'invalid_request_error',
      param: 'tool_choice',
      code: 'tool_choice_not_enforceable',
    },
  };
}

/**
 * Build an OpenAI-compatible error for strictAfterResponse rejection.
 * Returned when tool_choice required a tool call but the model returned no tool_calls.
 */
export function buildRequiredToolCallMissingError(): Record<string, unknown> {
  return {
    error: {
      message: 'tool_choice required a tool call, but the model returned no tool_calls.',
      type: 'invalid_request_error',
      param: 'tool_choice',
      code: 'required_tool_call_missing',
    },
  };
}
export function classifyToolChoice(toolChoice: unknown): string {
  if (toolChoice === undefined || toolChoice === null) {
    return 'missing';
  }
  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto' || toolChoice === 'none' || toolChoice === 'required') {
      return toolChoice;
    }
    return 'unsupported';
  }
  if (typeof toolChoice === 'object' && toolChoice !== null) {
    const tc = toolChoice as Record<string, unknown>;
    if (tc.type === 'function' && typeof tc.function === 'object' && tc.function !== null) {
      const fn = tc.function as Record<string, unknown>;
      if (typeof fn.name === 'string' && fn.name.length > 0) {
        return `function:${fn.name}`;
      }
    }
    return 'unsupported';
  }
  return 'unsupported';
}

/** Validation error for malformed tools, with OpenAI-compatible error shape. */
export interface ToolValidationError {
  message: string;
  status: number;
}

/**
 * Validate an OpenAI-compatible tools array.
 *
 * Rules:
 *   - tools must be an array (if present)
 *   - each tool must have type = "function"
 *   - each tool must have function.name as a non-empty string
 *   - function.description is preserved when present
 *   - function.parameters is preserved when present (JSON schema)
 *
 * Returns null if valid, or a ToolValidationError describing the first problem.
 */
export function validateTools(tools: unknown): ToolValidationError | null {
  if (tools === undefined || tools === null) {
    return null; // No tools is fine
  }
  if (!Array.isArray(tools)) {
    return { message: '"tools" must be an array', status: 400 };
  }

  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    if (typeof tool !== 'object' || tool === null) {
      return { message: `tools[${i}] must be an object`, status: 400 };
    }
    const t = tool as Record<string, unknown>;
    if (t.type !== 'function') {
      return {
        message: `tools[${i}].type must be "function", got "${String(t.type)}"`,
        status: 400,
      };
    }
    if (typeof t.function !== 'object' || t.function === null) {
      return { message: `tools[${i}].function must be an object`, status: 400 };
    }
    const fn = t.function as Record<string, unknown>;
    if (typeof fn.name !== 'string' || fn.name.length === 0) {
      return {
        message: `tools[${i}].function.name must be a non-empty string`,
        status: 400,
      };
    }
  }

  return null;
}

/**
 * Safe request-level tool diagnostics.
 *
 * Contains only metadata — no message content, no tool argument values,
 * no raw images, no sensitive data.
 */
export interface ToolRequestDiagnostics {
  /** Whether the request included a tools array. */
  tools_present: boolean;
  /** Number of tools in the request (0 if none). */
  tools_count: number;
  /** Classified tool_choice value. */
  tool_choice_category: string;
  /** Whether the request likely expects tool-capable responses. */
  is_agentic_request: boolean;
  /** Whether the bridge/backend can enforce tool_choice. */
  tool_choice_enforced: boolean;
  /** The active tool choice policy. */
  tool_choice_policy: ToolChoicePolicy;
  /** Whether the request was rejected at preflight due to policy. */
  preflight_rejected: boolean;
}

/**
 * Safe response-level tool diagnostics.
 *
 * Contains only metadata — no assistant text, no tool arguments,
 * no sensitive content.
 */
export interface ToolResponseDiagnostics {
  /** Whether the LM response contained text content. */
  lm_response_has_text: boolean;
  /** Whether the LM response contained tool calls. */
  lm_response_has_tool_calls: boolean;
  /** Number of tool calls in the LM response. */
  lm_response_tool_calls_count: number;
  /** Whether the mapped OpenAI response has an assistant message. */
  mapped_openai_has_assistant_message: boolean;
  /** The finish_reason in the mapped response. */
  mapped_openai_finish_reason: string | null;
  /** Whether tool_choice was enforced by the backend. */
  tool_choice_enforced: boolean;
  /** Whether tool_choice was requested by the client. */
  tool_choice_requested: boolean;
  /** Whether a required/specific tool call was expected but missing. */
  required_tool_call_missing: boolean;
  /** The active tool choice policy. */
  tool_choice_policy: ToolChoicePolicy;
  /** Whether the response was rejected after response due to policy. */
  rejected_after_response: boolean;
}

/**
 * Build safe request diagnostics from parsed request fields.
 */
export function buildRequestDiagnostics(
  tools: unknown,
  toolChoice: unknown,
  policy: ToolChoicePolicy = 'bestEffort'
): ToolRequestDiagnostics {
  const toolsPresent = Array.isArray(tools) && tools.length > 0;
  const toolsCount = toolsPresent ? (tools as unknown[]).length : 0;
  const category = classifyToolChoice(toolChoice);
  const requiresEnforcement = category === 'required' || category.startsWith('function:');
  // The VS Code LM API does not support enforcing tool_choice,
  // so we can never truly enforce "required" or a specific function.
  const toolChoiceEnforced = false;

  return {
    tools_present: toolsPresent,
    tools_count: toolsCount,
    tool_choice_category: category,
    is_agentic_request: toolsPresent || requiresEnforcement,
    tool_choice_enforced: toolChoiceEnforced,
    tool_choice_policy: policy,
    preflight_rejected: false,
  };
}

/**
 * Build safe response diagnostics after the LM response is fully mapped.
 */
export function buildResponseDiagnostics(
  hasText: boolean,
  toolCalls: unknown[],
  requestDiag: ToolRequestDiagnostics
): ToolResponseDiagnostics {
  const hasToolCalls = toolCalls.length > 0;
  const category = requestDiag.tool_choice_category;
  const requiresEnforcement = category === 'required' || category.startsWith('function:');
  const requiredMissing = requiresEnforcement && !hasToolCalls;

  return {
    lm_response_has_text: hasText,
    lm_response_has_tool_calls: hasToolCalls,
    lm_response_tool_calls_count: toolCalls.length,
    mapped_openai_has_assistant_message: true,
    mapped_openai_finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
    tool_choice_enforced: false,
    tool_choice_requested: requiresEnforcement,
    required_tool_call_missing: requiredMissing,
    tool_choice_policy: requestDiag.tool_choice_policy,
    rejected_after_response: false,
  };
}

/**
 * Generate a stable fallback tool_call ID when the backend doesn't provide one.
 * Format: "call_" + 24-char hex string derived from name + timestamp.
 */
export function generateToolCallId(name: string, index: number): string {
  const ts = Date.now().toString(16);
  const seed = `${name}-${index}-${ts}`;
  // Simple deterministic hash-like string from the seed
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `call_${hex}${ts.slice(-8).padStart(8, '0')}${index.toString(16).padStart(4, '0')}`.slice(0, 30);
}
