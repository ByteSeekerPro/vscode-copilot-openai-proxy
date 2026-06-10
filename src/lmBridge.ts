import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Content normalization helpers
// ---------------------------------------------------------------------------

/** Supported text-like content part types that can be converted to plain text. */
const TEXT_PART_TYPES = new Set(['text', 'input_text']);

/** Supported image content part types from OpenAI-compatible requests. */
const IMAGE_PART_TYPES = new Set(['image_url', 'input_image', 'image']);

/** Allowed image MIME types for data URL image parts. */
const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
]);

/**
 * Parse a data URL into its MIME type and binary data.
 *
 * Only accepts base64-encoded data URLs (e.g. `data:image/png;base64,...`).
 * Returns null if the URL is not a valid data URL.
 */
function parseDataUrl(url: string): { mimeType: string; data: Uint8Array } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) { return null; }
  const mimeType = match[1].toLowerCase().trim();
  const base64 = match[2];
  try {
    const buffer = Buffer.from(base64, 'base64');
    // Verify the base64 actually decoded to something
    if (buffer.length === 0) { return null; }
    return { mimeType, data: new Uint8Array(buffer) };
  } catch {
    return null;
  }
}

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

/**
 * Check whether any message in the array contains image content parts.
 * Does not validate image data — only detects presence.
 */
export function hasImageContent(messages: unknown[]): boolean {
  if (!Array.isArray(messages)) { return false; }
  for (const msg of messages) {
    if (typeof msg !== 'object' || msg === null) { continue; }
    const content = (msg as any).content;
    if (!Array.isArray(content)) { continue; }
    for (const part of content) {
      if (typeof part === 'object' && part !== null && IMAGE_PART_TYPES.has((part as any).type)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Result of processing a content array with image support.
 * Either a plain string (text-only content) or an array of VS Code LM parts.
 */
export type ContentParts = string | Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart>;

/**
 * Normalize an OpenAI-style message content value into VS Code LM message parts.
 *
 * When the content contains no image parts, returns a plain string (same as
 * `normalizeContent`). When image parts are present and the model supports
 * images, returns an array of LanguageModelTextPart / LanguageModelDataPart
 * suitable for `LanguageModelChatMessage.User()`.
 *
 * Throws ContentValidationError for:
 *   - Image parts when the model does not support images
 *   - Remote image URLs (not yet supported)
 *   - Invalid data URLs
 *   - Unsupported MIME types
 *   - Unsupported content part types
 */
export function normalizeContentToParts(
  content: unknown,
  supportsImage: boolean
): ContentParts {
  // Plain string — most common case
  if (typeof content === 'string') {
    return content;
  }

  // null / undefined — treat as empty
  if (content == null) {
    return '';
  }

  if (!Array.isArray(content)) {
    throw new ContentValidationError(
      `Unsupported message content type: ${typeof content}`
    );
  }

  // Quick check: does this array contain any image parts?
  const hasImage = content.some(
    (p) => typeof p === 'object' && p !== null && IMAGE_PART_TYPES.has((p as any).type)
  );

  // Text-only path — same logic as normalizeContent
  if (!hasImage) {
    return normalizeContent(content);
  }

  // Content has image parts — model must support images
  if (!supportsImage) {
    throw new ContentValidationError(
      'The selected model does not support image input. Remove image content parts or select a model with image support.'
    );
  }

  // Build VS Code LM parts array
  const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [];

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

    if (TEXT_PART_TYPES.has(partType)) {
      const text = (part as any).text;
      if (typeof text === 'string') {
        parts.push(new vscode.LanguageModelTextPart(text));
      }
      // Silently skip text parts with no text property
    } else if (IMAGE_PART_TYPES.has(partType)) {
      // Extract the image URL from the various supported shapes:
      //   { type: "image_url", image_url: { url: "..." } }
      //   { type: "input_image", image_url: { url: "..." } }
      //   { type: "image", url: "..." }          (less common)
      //   { type: "image_url", url: "..." }      (flat shape)
      const imageUrlObj = (part as any).image_url;
      const imageUrl =
        (typeof imageUrlObj === 'object' && imageUrlObj !== null && typeof imageUrlObj.url === 'string')
          ? imageUrlObj.url
          : (typeof (part as any).url === 'string')
            ? (part as any).url
            : null;

      if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
        throw new ContentValidationError(
          `Image content part "${partType}" is missing a valid URL.`
        );
      }

      // Only data URLs are supported — remote fetching is not implemented
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        throw new ContentValidationError(
          'Remote image URLs are not yet supported. Use a data URL (data:image/...;base64,...) instead.'
        );
      }

      // Parse data URL
      const parsed = parseDataUrl(imageUrl);
      if (!parsed) {
        throw new ContentValidationError(
          'Invalid image URL. Only base64 data URLs (data:image/...;base64,...) are supported.'
        );
      }

      // Validate MIME type
      if (!ALLOWED_IMAGE_MIMES.has(parsed.mimeType)) {
        throw new ContentValidationError(
          `Unsupported image MIME type "${parsed.mimeType}". Supported types: ${[...ALLOWED_IMAGE_MIMES].join(', ')}.`
        );
      }

      // Create LanguageModelDataPart for the image
      parts.push(vscode.LanguageModelDataPart.image(parsed.data, parsed.mimeType));
    } else {
      throw new ContentValidationError(
        `Unsupported content part type "${partType}". Supported types: text, input_text, image_url, input_image, image.`
      );
    }
  }

  return parts;
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
 *
 * @param messages The messages array from the request body.
 * @param options Optional configuration for validation.
 * @param options.supportsImage If true, image content parts are accepted
 *   and validated (data URLs only). If false/undefined, image parts
 *   cause a 400 error.
 */
export function validateMessages(messages: unknown, options?: { supportsImage?: boolean }): { status: number; error: string } | null {
  if (!Array.isArray(messages)) {
    return { status: 400, error: '"messages" must be an array' };
  }

  const supportsImage = !!options?.supportsImage;

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
          normalizeContentToParts(content, supportsImage);
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

    // Detect image support from model capabilities metadata
    const rawModel = model as any;
    const supportsImage = rawModel?.capabilities?.supportsImageToText === true;

    const vscodeMessages: vscode.LanguageModelChatMessage[] = this.mapMessages(messages, { supportsImage });
    
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

  /**
   * Look up model capabilities for a given model ID.
   * Returns an object with capability flags, defaulting to false.
   */
  async getModelCapabilities(modelId: string): Promise<{ supportsImageToText: boolean; supportsToolCalling: boolean }> {
    const models = await this.getModels();
    const model = models.find((m) => m.id === modelId) || models[0];
    if (!model) {
      return { supportsImageToText: false, supportsToolCalling: false };
    }
    const raw = model as any;
    return {
      supportsImageToText: raw?.capabilities?.supportsImageToText === true,
      supportsToolCalling: raw?.capabilities?.supportsToolCalling === true,
    };
  }

  private mapMessages(messages: any[], options?: { supportsImage?: boolean }): vscode.LanguageModelChatMessage[] {
    const vscodeMessages: vscode.LanguageModelChatMessage[] = [];
    let systemPrompt = '';
    const supportsImage = !!options?.supportsImage;

    for (const msg of messages) {
      // Normalize content — may be null for assistant messages with tool_calls
      const rawContent = msg.content;

      if (msg.role === 'system') {
        const text = rawContent != null ? normalizeContent(rawContent) : '';
        systemPrompt += (systemPrompt ? '\n' : '') + text;
      } else if (msg.role === 'user') {
        const contentParts = rawContent != null
          ? normalizeContentToParts(rawContent, supportsImage)
          : '';

        if (typeof contentParts === 'string') {
          // Text-only content (most common path)
          let content = contentParts;
          if (systemPrompt && vscodeMessages.length === 0) {
            content = `[System Instructions]\n${systemPrompt}\n[End System Instructions]\n\n${content}`;
            systemPrompt = '';
          }
          vscodeMessages.push(vscode.LanguageModelChatMessage.User(content));
        } else {
          // Mixed text + image parts
          const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [...contentParts];
          if (systemPrompt && vscodeMessages.length === 0) {
            // Prepend system prompt as a text part before the image parts
            parts.unshift(new vscode.LanguageModelTextPart(
              `[System Instructions]\n${systemPrompt}\n[End System Instructions]\n\n`
            ));
            systemPrompt = '';
          }
          vscodeMessages.push(vscode.LanguageModelChatMessage.User(parts));
        }
      } else if (msg.role === 'assistant') {
        const text = rawContent != null ? normalizeContent(rawContent) : '';
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
        const text = rawContent != null ? normalizeContent(rawContent) : '';
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
