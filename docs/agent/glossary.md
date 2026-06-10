# Glossary

| Term | Definition |
|---|---|
| **Copilot OpenAI Proxy** | The name of this VS Code extension. Exposes GitHub Copilot / VS Code Language Model API models through a local OpenAI-compatible HTTP service. |
| **vscode.lm** | VS Code's built-in Language Model API. Provides access to language models registered by extensions (e.g., GitHub Copilot). |
| **Language Model Chat** | A VS Code API type (`vscode.LanguageModelChat`) representing a chat-capable language model. |
| **LmBridge** | Internal class that translates between OpenAI API format and VS Code Language Model API format. Handles message mapping, tool mapping, and image input. |
| **Server** | Internal class wrapping Express HTTP server with OpenAI-compatible routes. 10 MB body limit. |
| **CallHistory** | Internal class managing persistent metadata-only call history stored as JSON in VS Code global storage. |
| **SessionMetrics** | Internal class tracking in-memory session metrics (request counts, token totals, latency, per-model breakdown). Not persisted across restarts. |
| **Config** | Internal module providing configuration helpers (port, autostart, retention days) from VS Code settings. |
| **SidebarProvider** | Internal class implementing `WebviewViewProvider` — manages the sidebar UI panel. |
| **SSE** | Server-Sent Events. Used for streaming chat completion responses from the server to the client. |
| **Tool Calls** | OpenAI function-calling feature. Mapped to VS Code's `LanguageModelToolCallPart`. |
| **Extension Development Host** | A separate VS Code instance launched by pressing `F5` for testing extensions during development. |
| **Copilot Chat** | The `github.copilot-chat` VS Code extension. Required runtime dependency — provides the language models. |
| **vsce** | VS Code Extension CLI tool used to package extensions into `.vsix` files. |
| **tsup** | TypeScript bundler used to produce the final `out/extension.js` bundle. |
| **workspaceState** | VS Code API for persisting key-value data scoped to the current workspace. Used to save port, model, and logging settings. |
| **WebviewViewProvider** | VS Code API interface for providing content to a sidebar panel webview. |
| **OpenAI-compatible API** | The HTTP API format this extension exposes — matches the OpenAI `/v1/chat/completions` and `/v1/models` endpoints. |
| **CommonJS (CJS)** | Module format used by the compiled output (`module: "commonjs"` in tsconfig). Required by VS Code extension host. |

## Acronyms

| Acronym | Meaning |
|---|---|
| LM | Language Model |
| API | Application Programming Interface |
| SSE | Server-Sent Events |
| CJS | CommonJS (module system) |
| VSIX | VS Code Extension package format |
