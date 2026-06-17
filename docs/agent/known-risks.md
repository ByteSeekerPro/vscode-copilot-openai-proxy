# Known Risks

## Fragile Areas

| Area | File(s) | Risk | Mitigation |
|---|---|---|---|
| Webview HTML template | [`src/webview/provider.ts`](src/webview/provider.ts:128) `_getHtmlForWebview()` | Single large template string generates entire UI HTML. Easy to break with small edits. | Test UI manually after any change to this method. |
| Socket tracking for server shutdown | [`src/server.ts`](src/server.ts:186-192) | Tracks open sockets to force-close on stop. Removing this causes port leaks. | Do not modify socket lifecycle without understanding keep-alive behavior. |
| System message prepending | [`src/lmBridge.ts`](src/lmBridge.ts:96) `mapMessages()` | System messages are manually prepended to the first user message with `[System Instructions]` wrapper. Fragile string concatenation. | Test with system messages if modifying message mapping. |
| Token counting | [`src/lmBridge.ts`](src/lmBridge.ts:27-36, 78-93) | Uses `model.countTokens()` which may not match OpenAI's tokenizer. Token counts are approximate. | Do not rely on exact token counts for business logic. |

## Security-Sensitive Areas

| Area | File(s) | Concern |
|---|---|---|
| Optional API authentication | [`src/server.ts`](src/server.ts), [`src/auth.ts`](src/auth.ts) | API-key auth is disabled by default (`requireApiKey=false`). When disabled, any local process can use the service. Enable `requireApiKey` when exposing on non-local interfaces (`0.0.0.0`). Constant-time comparison via `crypto.timingSafeEqual`. |
| CORS enabled for all origins | [`src/server.ts`](src/server.ts:20) | `cors()` with no options allows all origins. Acceptable for localhost service but risky if server is ever exposed. |
| Express JSON parsing | [`src/server.ts`](src/server.ts:19) | 10 MB body limit on `express.json()` to accommodate large agent conversation histories. Requests exceeding 10 MB return HTTP 413. |

## Performance-Sensitive Areas

| Area | File(s) | Concern |
|---|---|---|
| Model discovery caching | [`src/webview/provider.ts`](src/webview/provider.ts:86-118) | Model list is cached after first fetch. Stale cache if models change at runtime. |
| No request timeout | [`src/server.ts`](src/server.ts:47) | Chat completion requests have no timeout. A stuck model request blocks the response indefinitely. |
| Token counting overhead | [`src/lmBridge.ts`](src/lmBridge.ts:27-93) | Two separate `countTokens()` calls per request (prompt + completion). Adds latency to every request. |

## Legacy Assumptions

| Assumption | Location | Notes |
|---|---|---|
| `LanguageModelToolCallPart` cast to `any` | [`src/lmBridge.ts`](src/lmBridge.ts:60) | Uses `(vscode as any).LanguageModelToolCallPart` — may indicate this API type is not yet stable or was added after the initial `@types/vscode` version. |
| tool_choice cannot be enforced | [`src/toolHelpers.ts`](src/toolHelpers.ts:137) | The VS Code Language Model API does not support `tool_choice` enforcement. `tool_choice_enforced` is always `false`. Requests with `tool_choice:"required"` or specific function may still produce text-only responses. The `toolChoicePolicy` setting (`bestEffort`, `strictPreflight`, `strictAfterResponse`) controls how the bridge handles this. Logged via `[ToolDiag]` in the output channel. |
| strictAfterResponse streaming limitation | [`src/server.ts`](src/server.ts) | The `strictAfterResponse` policy cannot fully enforce rejection for streaming requests because SSE chunks are already sent to the client before the full response can be inspected. Streaming requests with `strictAfterResponse` behave as `bestEffort` with diagnostic logging. Use `strictPreflight` if streaming rejection is required. |
| Server `any` type | [`src/server.ts`](src/server.ts:9) | `private server: any` — the HTTP server instance is untyped. |
| State typed as `any` | [`src/webview/provider.ts`](src/webview/provider.ts:15) | `private _state: any` — sidebar state not strongly typed despite `State` interface existing in `extension.ts`. |

## External Dependencies

| Dependency | Risk |
|---|---|
| `github.copilot-chat` extension | Required runtime dependency. If disabled or uninstalled, no models are available. Extension will fail at runtime. |
| VS Code Language Model API (`vscode.lm`) | API surface may change between VS Code versions. The `^1.80.0` engine constraint may not cover all API features used. |
| Express 4.x | Stable but major version. Express 5 migration would require changes. |

## Areas Requiring Extra Review

- Any change to [`src/server.ts`](src/server.ts) routes — affects API compatibility with all clients.
- Any change to [`src/lmBridge.ts`](src/lmBridge.ts) message mapping — affects output quality and correctness.
- Any change to `package.json` `contributes` section — affects extension registration and UI.
- Any change to `.vscodeignore` — affects what gets packaged in the `.vsix`.

## Gaps

- `npm run test` is configured as `npm run bundle` (no unit test runner). Verification relies on compilation, bundling, and the compatibility test suite.
- No CI/CD configuration found.
- No Docker configuration found.
