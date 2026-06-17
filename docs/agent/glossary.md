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
| **Config** | Internal module providing configuration helpers (port, autostart, retention days, toolChoicePolicy) from VS Code settings. |
| **SidebarProvider** | Internal class implementing `WebviewViewProvider` — manages the sidebar UI panel. |
| **SSE** | Server-Sent Events. Used for streaming chat completion responses from the server to the client. |
| **Tool Calls** | OpenAI function-calling feature. Mapped to VS Code's `LanguageModelToolCallPart`. |
| **ToolHelpers** | Internal module providing tool request validation (`validateTools`), tool_choice classification (`classifyToolChoice`), policy helpers (`isToolChoiceRequired`, `buildToolChoiceNotEnforceableError`, `buildRequiredToolCallMissingError`), safe diagnostics (`buildRequestDiagnostics`, `buildResponseDiagnostics`), and tool_call ID generation (`generateToolCallId`). |
| **tool_choice_enforced** | Diagnostic flag indicating whether the backend could enforce the requested tool_choice. Always `false` for the VS Code Language Model API since it does not support tool_choice enforcement. |
| **toolChoicePolicy** | VS Code extension setting controlling how the bridge handles unenforceable OpenAI `tool_choice` values. Three modes: `bestEffort` (default), `strictPreflight`, `strictAfterResponse`. |
| **bestEffort** | Default tool choice policy. Forwards tools to VS Code LM API regardless. Returns valid assistant response even if tool_choice was required but no tool_calls were returned. Logs `required_tool_call_missing=true`. |
| **strictPreflight** | Tool choice policy that rejects requests with `tool_choice:"required"` or specific function before calling VS Code LM API. Returns HTTP 400 with `tool_choice_not_enforceable` error. |
| **strictAfterResponse** | Tool choice policy that sends the request to VS Code LM API but rejects the response if `tool_choice` required enforcement and no `tool_calls` were returned. Returns HTTP 400 with `required_tool_call_missing` error. Only fully enforceable for non-streaming requests; streaming behaves as `bestEffort` with diagnostics. |
| **[ToolDiag]** | Output channel log prefix for safe tool-related request/response diagnostics. Contains only metadata — no message content, tool arguments, or sensitive data. |
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
