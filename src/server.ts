import express from 'express';
import cors from 'cors';
import * as net from 'net';
import * as vscode from 'vscode';
import { LmBridge, validateMessages, ContentValidationError, hasImageContent } from './lmBridge';
import { CallHistoryStore, CallHistoryEntry } from './callHistory';
import { SessionMetricsStore } from './sessionMetrics';

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
      const { model, messages, stream, temperature, max_tokens, tools, tool_choice } = req.body;

      if (this.verbose) {
        this.outputChannel.appendLine(`[Request] Model: ${model}, Stream: ${!!stream}`);
        this.outputChannel.appendLine(`[Request Body] ${JSON.stringify(req.body, null, 2)}`);
      }

      // Detect image content presence for metadata tracking
      const requestHasImages = Array.isArray(messages) && hasImageContent(messages);

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

      try {
        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const responseStream = this.lmBridge.streamChatCompletion(model, messages, { temperature, max_tokens, stream }, tools, tool_choice);

          let finalUsage: any = null;
          for await (const chunk of responseStream) {
            if (typeof chunk === 'string') {
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
          this.recordEntry({
            endpoint: '/v1/chat/completions',
            model: model ?? null,
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            success: true,
            streaming: true,
            promptTokens: finalUsage?.prompt_tokens ?? null,
            completionTokens: finalUsage?.completion_tokens ?? null,
            totalTokens: finalUsage?.total_tokens ?? null,
            imageInput: requestHasImages || undefined,
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

          const responseData = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: fullText,
                  ...(tool_calls.length > 0 ? { tool_calls } : {})
                },
                finish_reason: tool_calls.length > 0 ? 'tool_calls' : 'stop',
              },
            ],
            usage: usage,
          };

          if (this.verbose) {
            this.outputChannel.appendLine(`[Response] ${JSON.stringify(responseData, null, 2)}`);
          }

          res.json(responseData);
          this.recordEntry({
            endpoint: '/v1/chat/completions',
            model: model ?? null,
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            success: true,
            streaming: false,
            promptTokens: usage.prompt_tokens ?? null,
            completionTokens: usage.completion_tokens ?? null,
            totalTokens: usage.total_tokens ?? null,
            imageInput: requestHasImages || undefined,
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

  /** Record a call history entry. Non-fatal — errors are logged, never thrown. */
  private recordEntry(fields: {
    endpoint: string;
    model?: string | null;
    statusCode?: number | null;
    latencyMs?: number | null;
    success?: boolean;
    streaming?: boolean | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    error?: string | null;
    imageInput?: boolean;
  }): void {
    const timestamp = new Date().toISOString();
    const entry: CallHistoryEntry = {
      id: Server.entryId(),
      timestamp,
      method: 'POST',
      endpoint: fields.endpoint,
      model: fields.model ?? null,
      statusCode: fields.statusCode ?? null,
      success: fields.success ?? true,
      latencyMs: fields.latencyMs ?? null,
      streaming: fields.streaming ?? null,
      promptTokens: fields.promptTokens ?? null,
      completionTokens: fields.completionTokens ?? null,
      totalTokens: fields.totalTokens ?? null,
      error: fields.error ?? null,
      imageInput: fields.imageInput ?? null,
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
      success: fields.success ?? true,
      statusCode: fields.statusCode ?? null,
      latencyMs: fields.latencyMs ?? null,
      streaming: fields.streaming ?? null,
      promptTokens: fields.promptTokens ?? null,
      completionTokens: fields.completionTokens ?? null,
      totalTokens: fields.totalTokens ?? null,
      error: fields.error ?? null,
    });
  }

  public isStarted(): boolean {
    return this.isRunning;
  }

  public async start(port: number): Promise<void> {
    if (this.isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, '127.0.0.1', () => {
          this.isRunning = true;
          this.outputChannel.appendLine(`Server started on http://127.0.0.1:${port}`);
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
