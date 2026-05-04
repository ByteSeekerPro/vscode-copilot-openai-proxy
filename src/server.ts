import express from 'express';
import cors from 'cors';
import * as net from 'net';
import * as vscode from 'vscode';
import { LmBridge } from './lmBridge';

export class Server {
  private app: express.Express;
  private server: any;
  private isRunning: boolean = false;
  private verbose: boolean = false;
  private _sockets = new Set<net.Socket>();

  constructor(
    private lmBridge: LmBridge,
    private outputChannel: vscode.OutputChannel
  ) {
    this.app = express();
    this.app.use(express.json());
    this.app.use(cors());

    this.registerRoutes();
  }

  public setVerbose(enabled: boolean) {
    this.verbose = enabled;
  }

  private registerRoutes() {
    this.app.get('/v1/models', async (_req, res) => {
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
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/v1/chat/completions', async (req, res) => {
      const { model, messages, stream, temperature, max_tokens, tools } = req.body;

      if (this.verbose) {
        this.outputChannel.appendLine(`[Request] Model: ${model}, Stream: ${!!stream}`);
        this.outputChannel.appendLine(`[Request Body] ${JSON.stringify(req.body, null, 2)}`);
      }

      try {
        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const responseStream = this.lmBridge.streamChatCompletion(model, messages, { temperature, max_tokens, stream }, tools);

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
        } else {
          // Non-streaming
          let fullText = '';
          let usage: any = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          let tool_calls: any[] = [];
          const responseStream = this.lmBridge.streamChatCompletion(model, messages, { temperature, max_tokens, stream: false }, tools);
          
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
        }
      } catch (error: any) {
        this.outputChannel.appendLine(`Error: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
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
