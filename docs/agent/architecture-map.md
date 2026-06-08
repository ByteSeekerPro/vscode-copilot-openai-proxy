# Architecture Map

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                    VS Code Host                      │
│                                                      │
│  ┌──────────┐    ┌───────────┐    ┌──────────────┐  │
│  │ Webview   │◄──►│ Sidebar   │◄──►│ Extension    │  │
│  │ main.js   │    │ Provider  │    │ activate()   │  │
│  └──────────┘    └───────────┘    └──────┬───────┘  │
│                                          │          │
│                                          ▼          │
│                                   ┌──────────────┐  │
│                                   │   Server      │  │
│                                   │  (Express)    │  │
│                                   └──────┬───────┘  │
│                                          │          │
│                                          ▼          │
│                                   ┌──────────────┐  │
│                                   │   LmBridge    │  │
│                                   └──────┬───────┘  │
│                                          │          │
│                                          ▼          │
│                               ┌────────────────────┐│
│                               │ vscode.lm API      ││
│                               │ (GitHub Copilot)   ││
│                               └────────────────────┘│
└─────────────────────────────────────────────────────┘

External clients (curl, Python, LangChain) ──► http://127.0.0.1:9090/v1
```

## Modules and Responsibilities

| Module | File | Responsibility |
|---|---|---|
| Extension | [`src/extension.ts`](src/extension.ts) | Lifecycle management, state persistence, wiring components together |
| Server | [`src/server.ts`](src/server.ts) | Express HTTP server, OpenAI-compatible API routes, SSE streaming |
| LmBridge | [`src/lmBridge.ts`](src/lmBridge.ts) | Translates OpenAI message format to VS Code LM API, handles token counting, maps tools |
| SidebarProvider | [`src/webview/provider.ts`](src/webview/provider.ts) | Webview management, model discovery, server start/stop orchestration |
| Webview Client | [`src/webview/main.js`](src/webview/main.js) | Client-side UI logic, message passing with extension host |
| Webview Styles | [`src/webview/style.css`](src/webview/style.css) | Sidebar panel styling |

## Dependency Direction

```
extension.ts  ──creates──►  SidebarProvider
extension.ts  ──creates──►  Server
extension.ts  ──creates──►  LmBridge

SidebarProvider  ──uses──►  Server (start/stop/isStarted)
SidebarProvider  ──uses──►  LmBridge (getModels)

Server  ──uses──►  LmBridge (streamChatCompletion, getModels)

LmBridge  ──uses──►  vscode.lm API (selectChatModels, sendRequest, countTokens)
```

No circular dependencies. Data flows unidirectionally: **HTTP request → Server → LmBridge → vscode.lm → response**.

## Data Flow: Chat Completion Request

1. External client sends `POST /v1/chat/completions` with OpenAI-format messages.
2. [`Server.registerRoutes()`](src/server.ts:29) parses the request body.
3. Server calls [`LmBridge.streamChatCompletion()`](src/lmBridge.ts:10).
4. LmBridge calls [`mapMessages()`](src/lmBridge.ts:96) to convert OpenAI messages to `vscode.LanguageModelChatMessage` (system messages prepended to first user message).
5. LmBridge calls `model.sendRequest()` on the VS Code Language Model API.
6. Response fragments are yielded as an async iterable — text fragments or tool call fragments.
7. Server formats each chunk into OpenAI SSE format (streaming) or accumulates into a single response (non-streaming).

## State Management

- Extension state is persisted via `context.workspaceState` (port, verboseLogging, selectedModel).
- The [`State`](src/extension.ts:6) interface defines the persisted shape.
- State changes flow from webview → SidebarProvider → extension.ts → workspaceState.
- Server running state is held in `Server.isRunning` — not persisted across VS Code restarts.

## Common Change Areas and First Files to Inspect

| Change Type | First File(s) |
|---|---|
| New API endpoint | `src/server.ts` |
| Change message format handling | `src/lmBridge.ts` → `mapMessages()` |
| Add new config option | `src/extension.ts` (State), `src/webview/provider.ts` (UI), `src/webview/main.js` (client) |
| Fix streaming behavior | `src/server.ts` (SSE formatting), `src/lmBridge.ts` (fragment handling) |
| Fix model discovery | `src/lmBridge.ts` → `getModels()`, `src/webview/provider.ts` → `_refreshModels()` |
| UI changes | `src/webview/main.js`, `src/webview/style.css`, `src/webview/provider.ts` → `_getHtmlForWebview()` |
| Tool/function calling | `src/lmBridge.ts` (tool mapping), `src/server.ts` (tool_call SSE chunks) |

## Architectural Boundaries and Assumptions

- **Single-model proxy**: The selected model in the sidebar is the model that processes ALL requests, regardless of the `model` field in incoming API requests.
- **Localhost only**: Server binds to `127.0.0.1` — not accessible from network.
- **No authentication**: API key is ignored; any string is accepted.
- **Copilot dependency**: Requires `github.copilot-chat` extension installed and active.
- **System message workaround**: VS Code LM API has no system role; system messages are prepended to the first user message with `[System Instructions]` wrapper.
- **Token counting is approximate**: Uses `model.countTokens()` which may not perfectly match OpenAI's tokenizer.
