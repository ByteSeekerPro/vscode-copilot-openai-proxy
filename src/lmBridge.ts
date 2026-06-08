import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Content normalization helpers
// ---------------------------------------------------------------------------

/** Supported text-like content part types that can be converted to plain text. */
const TEXT_PART_TYPES = new Set(['text', 'input_text']);

/**
 * Normalize an OpenAI-style message content value into a plain string.
 *
 * Accepts:
 *   - string pass-through
 *   - array of { type: "text", text: "..." } parts
 *   - array of { type: "input_text", text: "..." } parts
 *   - null / undefined → ""
 *
 * Throws on unsupported content types so the caller can return a 400.
 */
export function normalizeContent(content: unknown): string {
  // Plain string — most common case
  if (typeof content === 'string') {
    return content;
  }

  // null / undefined — treat as empty
  if (content == null) {
    return '';
  }

  // Array of content parts
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (typeof part !== 'object' || part === null) {
        throw new ContentValidationError(
          `Unsupported content part type: ${typeof part}`
        );
      }
      const partType = (part as any).type;
      if (typeof partType !== 'string') {
        throw new ContentValidationError(
          'Content part missing required "type" field'
        );
      }
      if (!TEXT_PART_TYPES.has(partType)) {
        throw new ContentValidationError(
          `Unsupported content part type "${partType}". Only text and input_text parts are supported.`
        );
      }
      const text = (part as any).text;
      if (typeof text === 'string') {
        texts.push(text);
      }
      // Silently skip parts with no text property
    }
    return texts.join('');
  }

  // Any other shape is unsupported
  throw new ContentValidationError(
    `Unsupported message content type: ${typeof content}`
  );
}

/** Error thrown by normalizeContent when content is invalid or unsupported. */
export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentValidationError';
  }
}

/**
 * Validate all messages in a request body. Returns null if valid, or an
 * object with status/message suitable for an HTTP 400 response.
 *
 * This is meant to be called from the server route *before* passing
 * messages to LmBridge, so the server can return a clean 400 instead of
 * a 500 from a VS Code API rejection.
 */
export function validateMessages(messages: unknown): { status: number; error: string } | null {
  if (!Array.isArray(messages)) {
    return { status: 400, error: '"messages" must be an array' };
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (typeof msg !== 'object' || msg === null) {
      return { status: 400, error: `messages[${i}] must be an object` };
    }
    const role = (msg as any).role;
    if (typeof role !== 'string') {
      return { status: 400, error: `messages[${i}].role must be a string` };
    }
    // Only validate content for roles that carry content
    if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
      const content = (msg as any).content;
      const hasToolCalls = Array.isArray((msg as any).tool_calls) && (msg as any).tool_calls.length > 0;
      // tool messages may have content=null legitimately
      // assistant messages may have content=null when they carry tool_calls
      if (role !== 'tool' && role !== 'assistant' && content == null) {
        return { status: 400, error: `messages[${i}].content must not be null for role "${role}"` };
      }
      if (role === 'assistant' && content == null && !hasToolCalls) {
        return { status: 400, error: `messages[${i}].content must not be null for role "assistant" without tool_calls` };
      }
      // Validate content shape when present (not null)
      if (content != null) {
        try {
          normalizeContent(content);
        } catch (err: any) {
          return {
            status: 400,
            error: `messages[${i}] content error: ${err.message}`,
          };
        }
      }
    }
  }
  return null;
}

export class LmBridge {
  constructor(private outputChannel?: vscode.OutputChannel) {}

  async getModels(): Promise<vscode.LanguageModelChat[]> {
    return await vscode.lm.selectChatModels();
  }

  async *streamChatCompletion(
    modelId: string,
    messages: any[],
    _options: { temperature?: number; max_tokens?: number; stream?: boolean },
    tools?: any[],
    _toolChoice?: any
  ): AsyncIterable<string | { type: 'tool_call', data: any } | { type: 'usage', data: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } }> {
    const models = await this.getModels();
    const model = models.find((m) => m.id === modelId) || models[0];

    this.outputChannel?.appendLine(`[Bridge] Using model: ${model?.id || 'default'}`);

    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const vscodeMessages: vscode.LanguageModelChatMessage[] = this.mapMessages(messages);
    
    // Calculate prompt tokens
    let promptTokens = 0;
    try {
        for (const msg of vscodeMessages) {
            promptTokens += await model.countTokens(msg, new vscode.CancellationTokenSource().token);
        }
        yield { type: 'usage', data: { prompt_tokens: promptTokens } };
    } catch (error) {
        console.error('Error computing prompt tokens:', error);
    }

    const requestOptions: vscode.LanguageModelChatRequestOptions = {
        justification: 'Copilot OpenAI Proxy request',
    };

    // Map OpenAI tools to VS Code tools
    if (tools && tools.length > 0) {
        this.outputChannel?.appendLine(`[Bridge] Mapping ${tools.length} tools...`);
        requestOptions.tools = tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            inputSchema: t.function.parameters
        }));
    }

    const response = await model.sendRequest(vscodeMessages, requestOptions, new vscode.CancellationTokenSource().token);

    let fullText = '';
    const toolCalls: any[] = [];
    for await (const fragment of response.stream) {
        if (fragment instanceof vscode.LanguageModelTextPart) {
            fullText += fragment.value;
            yield fragment.value;
        } else if (fragment instanceof (vscode as any).LanguageModelToolCallPart) {
            const toolCallData = {
                id: (fragment as any).callId,
                type: 'function',
                function: {
                    name: (fragment as any).name,
                    arguments: JSON.stringify((fragment as any).input)
                }
            };
            toolCalls.push(toolCallData);
            yield {
                type: 'tool_call',
                data: toolCallData
            };
        }
    }

    // Calculate completion tokens (including tool calls)
    try {
        let completionText = fullText;
        for (const chunk of toolCalls) {
            // Add a string representation of the tool call to ensure it's counted
            completionText += `\nTool Call: ${chunk.function.name}(${chunk.function.arguments})`;
        }
        
        const completionTokens = await model.countTokens(completionText, new vscode.CancellationTokenSource().token);
        yield { type: 'usage', data: { 
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens, 
            total_tokens: promptTokens + completionTokens 
        } };
    } catch (error) {
        console.error('Error computing completion tokens:', error);
    }
  }

  private mapMessages(messages: any[]): vscode.LanguageModelChatMessage[] {
    const vscodeMessages: vscode.LanguageModelChatMessage[] = [];
    let systemPrompt = '';

    for (const msg of messages) {
      // Normalize content — may be null for assistant messages with tool_calls
      const rawContent = msg.content;
      const text = rawContent != null ? normalizeContent(rawContent) : '';

      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n' : '') + text;
      } else if (msg.role === 'user') {
        let content = text;
        if (systemPrompt && vscodeMessages.length === 0) {
          content = `[System Instructions]\n${systemPrompt}\n[End System Instructions]\n\n${content}`;
          systemPrompt = ''; // Only prepend to the first user message
        }
        vscodeMessages.push(vscode.LanguageModelChatMessage.User(content));
      } else if (msg.role === 'assistant') {
        // Build assistant text including any tool_calls for context
        let assistantText = text;
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          const toolCallParts: string[] = [];
          for (const tc of msg.tool_calls) {
            const fn = tc.function || {};
            toolCallParts.push(
              `[Tool Call: ${fn.name || 'unknown'} (id: ${tc.id || 'unknown'})]\nArguments: ${fn.arguments || '{}'}`
            );
          }
          const toolCallText = toolCallParts.join('\n');
          assistantText = assistantText
            ? `${assistantText}\n${toolCallText}`
            : toolCallText;
        }
        vscodeMessages.push(vscode.LanguageModelChatMessage.Assistant(assistantText));
      } else if (msg.role === 'tool') {
        // VS Code LM API does not natively support tool result messages.
        // Convert to a user message with a clear prefix so the model can
        // still understand the context of the tool output.
        const toolId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : 'unknown';
        vscodeMessages.push(
          vscode.LanguageModelChatMessage.User(
            `[Tool Result for ${toolId}]\n${text}`
          )
        );
      }
    }

    return vscodeMessages;
  }
}
