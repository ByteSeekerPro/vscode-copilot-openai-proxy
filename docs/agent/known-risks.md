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
| No API authentication | [`src/server.ts`](src/server.ts:29) | The server accepts any API key. Any local process can use the service. This is intentional (localhost-only) but agents should not add network exposure. |
| CORS enabled for all origins | [`src/server.ts`](src/server.ts:20) | `cors()` with no options allows all origins. Acceptable for localhost service but risky if server is ever exposed. |
| Express JSON parsing | [`src/server.ts`](src/server.ts:19) | No request size limit configured on `express.json()`. Large payloads could cause memory issues. |

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

- No test files found in `src/` despite `test` script pointing to `out/test/runTest.js`. Test infrastructure may be incomplete or missing.
- No CI/CD configuration found.
- No Docker configuration found.
