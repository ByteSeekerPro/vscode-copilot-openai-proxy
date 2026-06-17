import express from 'express';
import cors from 'cors';
import * as net from 'net';
import * as os from 'os';
import * as vscode from 'vscode';
import { LmBridge, validateMessages, ContentValidationError, hasImageContent } from './lmBridge';
import {
  validateTools,
  buildRequestDiagnostics,
  buildResponseDiagnostics,
  isToolChoiceRequired,
  buildToolChoiceNotEnforceableError,
  buildRequiredToolCallMissingError,
} from './toolHelpers';
import { getToolChoicePolicy, DEFAULT_HOST, isLocalHost, getRequireApiKey, getApiKey } from './config';
import { validateAuth } from './auth';
import { CallHistoryStore, CallHistoryEntry } from './callHistory';
import { SessionMetricsStore } from './sessionMetrics';
import { calculateCost, formatCostUsd } from './pricing';

export class Server {
  private app: express.Express;
  private server: any;
  private isRunning: boolean = false;
  private verbose: boolean = false;
  private _sockets = new Set<net.Socket>();

  constructor(
    private lmBridge: LmBridge,
    private outputChannel: vscode.OutputChannel,
    private callHistoryStore: CallHistoryStore,
    private sessionMetricsStore: SessionMetricsStore
  ) {
    this.app = express();
    // 10 MB body limit — agents (Zoo Code, LangChain, etc.) may send large
    // conversation histories with tool results. Express default is 100 KB.
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(cors());

    this.registerRoutes();
  }

  public setVerbose(enabled: boolean) {
    this.verbose = enabled;
  }

  /** Generate a unique call history entry ID. */
  private static entryId(): string {
    return `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private registerRoutes() {
    this.app.get('/v1/models', async (_req, res) => {
      const startTime = Date.now();

      // Auth check — reads settings at request time so changes apply without restart.
      const authResult = validateAuth(_req, getRequireApiKey(), getApiKey());
      if (!authResult.ok) {
        this.outputChannel.appendLine(
          `[Auth] GET /v1/models — ${authResult.status} ${authResult.error.error.code}`
        );
        res.status(authResult.status).json(authResult.error);
        return;
      }

      try {
        const models = await this.lmBridge.getModels();
        res.json({
          object: 'list',
          data: models.map((m) => ({
            id: m.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'vscode',
          })),
        });
        this.recordEntry({
          endpoint: '/v1/models',
          statusCode: 200,
          latencyMs: Date.now() - startTime,
          success: true,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
        this.recordEntry({
          endpoint: '/v1/models',
          statusCode: 500,
          latencyMs: Date.now() - startTime,
          success: false,
          error: error.message,
        });
      }
    });

    this.app.post('/v1/chat/completions', async (req, res) => {
      const startTime = Date.now();

      // Auth check — reads settings at request time so changes apply without restart.
      const authResult = validateAuth(req, getRequireApiKey(), getApiKey());
      if (!authResult.ok) {
        this.outputChannel.appendLine(
          `[Auth] POST /v1/chat/completions — ${authResult.status} ${authResult.error.error.code}`
        );
        res.status(authResult.status).json(authResult.error);
        return;
      }

      const { model, messages, stream, temperature, max_tokens, tools, tool_choice } = req.body;

      if (this.verbose) {
        this.outputChannel.appendLine(`[Request] Model: ${model}, Stream: ${!!stream}`);
        this.outputChannel.appendLine(`[Request Body] ${JSON.stringify(req.body, null, 2)}`);
      }

      // Detect image content presence for metadata tracking
      const requestHasImages = Array.isArray(messages) && hasImageContent(messages);

      // -----------------------------------------------------------------
      // Tool choice policy
      // -----------------------------------------------------------------
      const toolChoicePolicy = getToolChoicePolicy();

      // -----------------------------------------------------------------
      // Tool request diagnostics (safe metadata only — no content/args)
      // -----------------------------------------------------------------
      const reqDiag = buildRequestDiagnostics(tools, tool_choice, toolChoicePolicy);
      this.outputChannel.appendLine(
        `[ToolDiag] tools_present=${reqDiag.tools_present} tools_count=${reqDiag.tools_count} tool_choice=${reqDiag.tool_choice_category} agentic=${reqDiag.is_agentic_request} enforced=${reqDiag.tool_choice_enforced} policy=${reqDiag.tool_choice_policy}`
      );

      // -----------------------------------------------------------------
      // Validate incoming tools
      // -----------------------------------------------------------------
      const toolValidationError = validateTools(tools);
      if (toolValidationError) {
        res.status(toolValidationError.status).json({
          error: {
            message: toolValidationError.message,
            type: 'invalid_request_error',
            param: 'tools',
            code: 'invalid_tools',
          },
        });
        this.recordEntry({
          endpoint: '/v1/chat/completions',
          model: model ?? null,
          statusCode: toolValidationError.status,
          latencyMs: Date.now() - startTime,
          success: false,
          streaming: typeof stream === 'boolean' ? stream : null,
          error: toolValidationError.message,
          imageInput: requestHasImages || undefined,
        });
        return;
      }

      // Look up model capabilities to determine if image input is supported.
      // This is needed before validation so we can accept image parts for
      // image-capable models instead of rejecting them outright.
      let supportsImage = false;
      try {
        const caps = await this.lmBridge.getModelCapabilities(model);
        supportsImage = caps.supportsImageToText;
      } catch {
        // If capability lookup fails, treat as no image support
        supportsImage = false;
      }

      // Validate message content shapes before passing to VS Code LM API.
      // When supportsImage is true, image content parts are accepted and
      // validated (data URLs only). When false, image parts cause a 400.
      const validationError = validateMessages(messages, { supportsImage });
      if (validationError) {
        res.status(validationError.status).json({
          error: { message: validationError.error, type: 'invalid_request_error', code: 'unsupported_image_input' },
        });
        this.recordEntry({
          endpoint: '/v1/chat/completions',
          model: model ?? null,
          statusCode: validationError.status,
          latencyMs: Date.now() - startTime,
          success: false,
          streaming: typeof stream === 'boolean' ? stream : null,
          error: validationError.error,
          imageInput: requestHasImages || undefined,
        });
        return;
      }

      // -----------------------------------------------------------------
      // Tool choice policy: strictPreflight
      // Reject before calling VS Code LM when tool_choice requires
      // enforcement and the policy mandates preflight rejection.
      // Applies to both streaming and non-streaming requests.
      // -----------------------------------------------------------------
      if (
        toolChoicePolicy === 'strictPreflight' &&
        isToolChoiceRequired(reqDiag.tool_choice_category) &&
        !reqDiag.tool_choice_enforced
      ) {
        reqDiag.preflight_rejected = true;
        this.outputChannel.appendLine(
          `[ToolDiag] tool_choice_policy=${reqDiag.tool_choice_policy} tool_choice_requested=true tool_choice_enforced=${reqDiag.tool_choice_enforced} preflight_rejected=true`
        );
        res.status(400).json(buildToolChoiceNotEnforceableError());
        this.recordEntry({
          endpoint: '/v1/chat/completions',
          model: model ?? null,
          requestedModel: model ?? null,
          statusCode: 400,
          latencyMs: Date.now() - startTime,
          success: false,
          streaming: typeof stream === 'boolean' ? stream : null,
          error: 'tool_choice_not_enforceable',
          imageInput: requestHasImages || undefined,
        });
        return;
      }

      try {
        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const responseStream = this.lmBridge.streamChatCompletion(model, messages, { temperature, max_tokens, stream }, tools, tool_choice);

          let finalUsage: any = null;
          let streamHasToolCalls = false;
          let streamHasText = false;
          let roleEmitted = false;

          for await (const chunk of responseStream) {
            // Emit the initial role delta once, on the first content/tool chunk
            if (!roleEmitted && (typeof chunk === 'string' || chunk.type === 'tool_call')) {
              const roleDelta = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [
                  {
                    index: 0,
                    delta: { role: 'assistant' },
                    finish_reason: null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(roleDelta)}\n\n`);
              roleEmitted = true;
            }

            if (typeof chunk === 'string') {
              streamHasText = true;
              const data = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [
                  {
                    index: 0,
                    delta: { content: chunk },
                    finish_reason: null,
                  },
                ],
              };
              if (this.verbose) {
                this.outputChannel.appendLine(`[Stream Chunk] ${chunk}`);
              }
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } else if (chunk.type === 'tool_call') {
              streamHasToolCalls = true;
              const data = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [
                  {
                    index: 0,
                    delta: { tool_calls: [chunk.data] },
                    finish_reason: null,
                  },
                ],
              };
              if (this.verbose) {
                this.outputChannel.appendLine(`[Stream Tool Call] ${JSON.stringify(chunk.data)}`);
              }
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } else if (chunk.type === 'usage') {
              finalUsage = chunk.data;
            }
          }

          // Emit final chunk with finish_reason
          const finalFinishReason = streamHasToolCalls ? 'tool_calls' : 'stop';
          const finalChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: finalFinishReason,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);

          if (finalUsage) {
            const usageData = {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [],
              usage: finalUsage
            };
            res.write(`data: ${JSON.stringify(usageData)}\n\n`);
          }

          res.write('data: [DONE]\n\n');
          res.end();

          // Response diagnostics (safe metadata only)
          const streamRespDiag = buildResponseDiagnostics(streamHasText, streamHasToolCalls ? [{ _stub: true }] : [], reqDiag);
          // Note: strictAfterResponse is not fully enforceable for streaming
          // because chunks are already sent before we can inspect the full response.
          // It behaves as bestEffort with diagnostic logging for streaming requests.
          this.outputChannel.appendLine(
            `[ToolDiag:stream] has_text=${streamRespDiag.lm_response_has_text} has_tool_calls=${streamRespDiag.lm_response_has_tool_calls} tool_calls_count=${streamRespDiag.lm_response_tool_calls_count} finish_reason=${streamRespDiag.mapped_openai_finish_reason} enforced=${streamRespDiag.tool_choice_enforced} required_missing=${streamRespDiag.required_tool_call_missing} policy=${streamRespDiag.tool_choice_policy}`
          );

          // Determine the effective model that was actually used.
          // The bridge may resolve "auto" to a concrete model ID.
          const effectiveModel = finalUsage?.effective_model_id ?? null;
          if (model !== effectiveModel && effectiveModel) {
            this.outputChannel.appendLine(
              `[Model Resolution] requested=${model} effective=${effectiveModel}`
            );
          }

          // Resolve pricing for the effective model and compute cost.
          const costEstimate = await this.resolveCost(
            effectiveModel ?? model,
            finalUsage?.prompt_tokens ?? null,
            finalUsage?.completion_tokens ?? null
          );

          this.recordEntry({
            endpoint: '/v1/chat/completions',
            model: model ?? null,
            requestedModel: model ?? null,
            effectiveModel: effectiveModel,
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            success: true,
            streaming: true,
            promptTokens: finalUsage?.prompt_tokens ?? null,
            completionTokens: finalUsage?.completion_tokens ?? null,
            totalTokens: finalUsage?.total_tokens ?? null,
            imageInput: requestHasImages || undefined,
            costEstimate,
          });
        } else {
          // Non-streaming
          let fullText = '';
          let usage: any = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          const tool_calls: any[] = [];
          const responseStream = this.lmBridge.streamChatCompletion(model, messages, { temperature, max_tokens, stream: false }, tools, tool_choice);
          
          for await (const chunk of responseStream) {
            if (typeof chunk === 'string') {
              fullText += chunk;
            } else if (chunk.type === 'tool_call') {
              tool_calls.push(chunk.data);
            } else if (chunk.type === 'usage') {
              usage = { ...usage, ...chunk.data };
            }
          }

          // Build the OpenAI-compatible assistant message.
          // Per OpenAI spec: content is null when tool_calls are present.
          const hasToolCalls = tool_calls.length > 0;
          const assistantMessage: Record<string, unknown> = {
            role: 'assistant',
            content: hasToolCalls ? null : (fullText || ''),
            ...(hasToolCalls ? { tool_calls } : {}),
          };

          const responseData = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [
              {
                index: 0,
                message: assistantMessage,
                finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
              },
            ],
            usage: usage,
          };

          if (this.verbose) {
            this.outputChannel.appendLine(`[Response] ${JSON.stringify(responseData, null, 2)}`);
          }

          // Response diagnostics (safe metadata only)
          const respDiag = buildResponseDiagnostics(fullText.length > 0, tool_calls, reqDiag);
          this.outputChannel.appendLine(
            `[ToolDiag] has_text=${respDiag.lm_response_has_text} has_tool_calls=${respDiag.lm_response_has_tool_calls} tool_calls_count=${respDiag.lm_response_tool_calls_count} finish_reason=${respDiag.mapped_openai_finish_reason} enforced=${respDiag.tool_choice_enforced} required_missing=${respDiag.required_tool_call_missing} policy=${respDiag.tool_choice_policy}`
          );

          // -----------------------------------------------------------------
          // Tool choice policy: strictAfterResponse
          // If tool_choice required enforcement and no tool_calls were returned,
          // reject with an OpenAI-compatible error instead of returning text.
          // -----------------------------------------------------------------
          if (
            toolChoicePolicy === 'strictAfterResponse' &&
            respDiag.required_tool_call_missing
          ) {
            respDiag.rejected_after_response = true;
            this.outputChannel.appendLine(
              `[ToolDiag] tool_choice_policy=${respDiag.tool_choice_policy} required_tool_call_missing=true rejected_after_response=true has_text=${respDiag.lm_response_has_text} has_tool_calls=${respDiag.lm_response_has_tool_calls}`
            );
            res.status(400).json(buildRequiredToolCallMissingError());
            this.recordEntry({
              endpoint: '/v1/chat/completions',
              model: model ?? null,
              requestedModel: model ?? null,
              effectiveModel: usage.effective_model_id ?? null,
              statusCode: 400,
              latencyMs: Date.now() - startTime,
              success: false,
              streaming: false,
              promptTokens: usage.prompt_tokens ?? null,
              completionTokens: usage.completion_tokens ?? null,
              totalTokens: usage.total_tokens ?? null,
              error: 'required_tool_call_missing',
              imageInput: requestHasImages || undefined,
            });
            return;
          }

          res.json(responseData);

          // Determine the effective model that was actually used.
          const effectiveModel = usage.effective_model_id ?? null;
          if (model !== effectiveModel && effectiveModel) {
            this.outputChannel.appendLine(
              `[Model Resolution] requested=${model} effective=${effectiveModel}`
            );
          }

          // Resolve pricing for the effective model and compute cost.
          const costEstimate = await this.resolveCost(
            effectiveModel ?? model,
            usage.prompt_tokens ?? null,
            usage.completion_tokens ?? null
          );

          this.recordEntry({
            endpoint: '/v1/chat/completions',
            model: model ?? null,
            requestedModel: model ?? null,
            effectiveModel: effectiveModel,
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            success: true,
            streaming: false,
            promptTokens: usage.prompt_tokens ?? null,
            completionTokens: usage.completion_tokens ?? null,
            totalTokens: usage.total_tokens ?? null,
            imageInput: requestHasImages || undefined,
            costEstimate,
          });
        }
      } catch (error: any) {
        const statusCode = error instanceof ContentValidationError ? 400 : 500;
        this.outputChannel.appendLine(`Error: ${error.message}`);
        if (statusCode === 400) {
          res.status(400).json({
            error: { message: error.message, type: 'invalid_request_error', code: null },
          });
        } else {
          res.status(500).json({
            error: { message: error.message, type: 'server_error', code: 'internal_error' },
          });
        }
        this.recordEntry({
          endpoint: '/v1/chat/completions',
          model: model ?? null,
          requestedModel: model ?? null,
          effectiveModel: null,
          statusCode: statusCode,
          latencyMs: Date.now() - startTime,
          success: false,
          streaming: typeof stream === 'boolean' ? stream : null,
          error: error.message,
          imageInput: requestHasImages || undefined,
        });
      }
    });
  }

  /**
   * Resolve pricing for a model and compute cost estimate.
   * Non-fatal — returns null if pricing is unavailable or lookup fails.
   */
  private async resolveCost(
    effectiveModelId: string | undefined | null,
    promptTokens: number | null,
    completionTokens: number | null
  ) {
    if (!effectiveModelId) {
      return null;
    }
    try {
      const pricing = await this.lmBridge.getModelPricingInfo(effectiveModelId);
      const estimate = calculateCost(pricing, promptTokens, completionTokens);
      if (estimate.pricingAvailable && this.verbose) {
        this.outputChannel.appendLine(
          `[Cost] ${effectiveModelId}: input=${formatCostUsd(estimate.inputCostUsd)} output=${formatCostUsd(estimate.outputCostUsd)} total=${formatCostUsd(estimate.totalCostUsd)}`
        );
      }
      return { pricing, estimate, effectiveModelId };
    } catch {
      // Pricing lookup failure is non-fatal.
      return null;
    }
  }

  /** Record a call history entry. Non-fatal — errors are logged, never thrown. */
  private recordEntry(fields: {
    endpoint: string;
    model?: string | null;
    /** The model ID from the request body (e.g. "auto"). */
    requestedModel?: string | null;
    /** The effective/concrete model ID resolved by the bridge, or null. */
    effectiveModel?: string | null;
    statusCode?: number | null;
    latencyMs?: number | null;
    success?: boolean;
    streaming?: boolean | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    error?: string | null;
    imageInput?: boolean;
    costEstimate?: {
      pricing: import('./pricing').ModelPricingInfo | null;
      estimate: import('./pricing').CostEstimate;
      effectiveModelId: string;
    } | null;
  }): void {
    const timestamp = new Date().toISOString();

    // Compute cost fields from the estimate.
    const cost = fields.costEstimate;
    const pricingAvailable = cost?.estimate.pricingAvailable ?? null;
    const inputCostUsd = cost?.estimate.pricingAvailable ? cost.estimate.inputCostUsd : null;
    const outputCostUsd = cost?.estimate.pricingAvailable ? cost.estimate.outputCostUsd : null;
    const totalCostUsd = cost?.estimate.pricingAvailable ? cost.estimate.totalCostUsd : null;
    const pricingModel = cost?.effectiveModelId ?? null;

    const entry: CallHistoryEntry = {
      id: Server.entryId(),
      timestamp,
      method: 'POST',
      endpoint: fields.endpoint,
      model: fields.model ?? null,
      requestedModel: fields.requestedModel ?? fields.model ?? null,
      effectiveModel: fields.effectiveModel ?? null,
      statusCode: fields.statusCode ?? null,
      success: fields.success ?? true,
      latencyMs: fields.latencyMs ?? null,
      streaming: fields.streaming ?? null,
      promptTokens: fields.promptTokens ?? null,
      completionTokens: fields.completionTokens ?? null,
      totalTokens: fields.totalTokens ?? null,
      error: fields.error ?? null,
      imageInput: fields.imageInput ?? null,
      estimatedInputCostUsd: inputCostUsd,
      estimatedOutputCostUsd: outputCostUsd,
      estimatedTotalCostUsd: totalCostUsd,
      pricingModel,
      pricingAvailable: pricingAvailable ?? undefined,
    };
    this.callHistoryStore.append(entry).catch((err) => {
      this.outputChannel.appendLine(`[CallHistory] Write failed: ${err.message ?? err}`);
    });

    // Record into in-memory session metrics (independent of persistent call history).
    this.sessionMetricsStore.record({
      timestamp,
      endpoint: fields.endpoint,
      method: 'POST',
      model: fields.model ?? null,
      requestedModel: fields.requestedModel ?? fields.model ?? null,
      effectiveModel: fields.effectiveModel ?? null,
      success: fields.success ?? true,
      statusCode: fields.statusCode ?? null,
      latencyMs: fields.latencyMs ?? null,
      streaming: fields.streaming ?? null,
      promptTokens: fields.promptTokens ?? null,
      completionTokens: fields.completionTokens ?? null,
      totalTokens: fields.totalTokens ?? null,
      error: fields.error ?? null,
      estimatedInputCostUsd: inputCostUsd,
      estimatedOutputCostUsd: outputCostUsd,
      estimatedTotalCostUsd: totalCostUsd,
      pricingModel,
      pricingAvailable: pricingAvailable ?? undefined,
      inputUsdPer1M: cost?.pricing?.inputUsdPer1M ?? null,
      outputUsdPer1M: cost?.pricing?.outputUsdPer1M ?? null,
    });
  }

  public isStarted(): boolean {
    return this.isRunning;
  }

  public async start(port: number, host: string = DEFAULT_HOST): Promise<void> {
    if (this.isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, host, () => {
          this.isRunning = true;
          const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
          this.outputChannel.appendLine(`Server started on http://${displayHost}:${port}`);
          if (host === '0.0.0.0') {
            this.outputChannel.appendLine(`  Bind host: 0.0.0.0 (all interfaces)`);
            this.outputChannel.appendLine(`  Local URL: http://127.0.0.1:${port}`);
            try {
              const interfaces = os.networkInterfaces();
              for (const entries of Object.values(interfaces)) {
                if (!entries) { continue; }
                for (const entry of entries) {
                  if (entry.family === 'IPv4' && !entry.internal) {
                    this.outputChannel.appendLine(`  Network URL: http://${entry.address}:${port}`);
                  }
                }
              }
            } catch {
              // Non-fatal — LAN IP display is best-effort.
            }
          }
          // API-key auth status logging
          const requireKey = getRequireApiKey();
          const configuredKey = getApiKey();
          this.outputChannel.appendLine(
            `API-key auth: ${requireKey ? 'enabled' : 'disabled'}${requireKey ? (configuredKey ? ' (configured)' : ' (no key configured!)') : ''}`
          );
          if (!isLocalHost(host) && !requireKey) {
            this.outputChannel.appendLine(
              'Security warning: the bridge is reachable on a non-local interface and API-key authentication is disabled.'
            );
          }
          resolve();
        });

        // Track all open connections so we can forcibly destroy them on stop().
        // Without this, server.close() waits for keep-alive connections to drain
        // on their own, which means its callback never fires.
        this.server.on('connection', (socket: net.Socket) => {
          this._sockets.add(socket);
          socket.once('close', () => this._sockets.delete(socket));
        });

        this.server.on('error', (err: any) => {
          this.isRunning = false;
          this.outputChannel.appendLine(`Server error: ${err.message}`);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) {
      this.isRunning = false;
      return;
    }

    // Set isRunning false immediately so callers (UI) can update without waiting
    // for the async close to complete.
    this.isRunning = false;

    // Destroy all open keep-alive sockets so server.close() fires right away.
    for (const socket of this._sockets) {
      socket.destroy();
    }
    this._sockets.clear();

    return new Promise((resolve) => {
      // Timeout fallback in case close() still hangs for any reason.
      const timeout = setTimeout(() => {
        this.server = null;
        this.outputChannel.appendLine('Server stop timed out — force closed.');
        resolve();
      }, 3000);

      this.server.close(() => {
        clearTimeout(timeout);
        this.server = null;
        this.outputChannel.appendLine('Server stopped.');
        resolve();
      });
    });
  }

  public getStatus() {
    return this.isRunning;
  }
}
