# GitHub Copilot OpenAI Proxy

A VS Code extension that exposes GitHub Copilot / VS Code Language Model API models through a local OpenAI-compatible HTTP API. This allows agent tools, coding assistants, and OpenAI-compatible clients to use the models available through your VS Code / GitHub Copilot setup.

## Important Clarification

- This project does **not** provide free model access by itself.
- It uses the models available through the user's VS Code / GitHub Copilot setup.
- Available models, capabilities, token limits, and pricing metadata depend on what VS Code exposes at runtime.
- An active GitHub Copilot subscription or equivalent VS Code access is required.

## Use Cases

- **Agent tools** — give AI coding agents access to Copilot models via a standard API
- **Coding assistants** — integrate with tools that speak the OpenAI API format
- **OpenAI-compatible clients** — use any tool that supports the OpenAI `/v1/chat/completions` endpoint
- **Local experiments** — test prompts and model behavior against your Copilot models
- **Tools needing Copilot access** — access GitHub Copilot models without a direct OpenAI API key

## Features

- Local OpenAI-compatible API (default: `http://127.0.0.1:9090/v1`)
- Configurable host and port — bind to `127.0.0.1` (local-only, default) or `0.0.0.0` (LAN/network)
- Optional Bearer-token API-key authentication (`requireApiKey` + `apiKey`)
- `toolChoicePolicy` for agent compatibility (`bestEffort`, `strictPreflight`, `strictAfterResponse`)
- `GET /v1/models` — list available models
- `POST /v1/chat/completions` — streaming and non-streaming chat completions
- Sidebar UI with server status, model selection, metadata display, and call history
- Quick Copy support for local/network URLs and curl commands
- Model metadata and raw model metadata display
- AIC pricing display when raw metadata provides it
- Metadata-only call history (prompts and responses are never persisted)
- In-memory session metrics
- OpenAI agent compatibility: `tools`, `tool_choice`, `role: tool`, assistant `tool_calls`
- Image input support for data URL images on image-capable models
- OpenAI compatibility test script with host/auth environment variables

## Installation

### From VSIX

```cmd
code --install-extension vscode-copilot-openai-proxy-1.0.2.vsix
```

### From Development Checkout

1. Clone the repository.
2. Run `npm install`.
3. Open the project in VS Code and press `F5` to launch the Extension Development Host.

## Quick Start

1. Open the project in VS Code.
2. Launch the extension (press `F5` to open the Extension Development Host).
3. In the Extension Development Host, open the **Copilot OpenAI Proxy** sidebar panel.
4. Select a model and click **Start Server** (or enable autostart in settings).
5. The server starts on `http://127.0.0.1:{port}/v1` (default port: 9090).

### Connection Details

- **Base URL**: `http://127.0.0.1:9090/v1`
- **LAN Base URL** (when host is `0.0.0.0`): `http://<host-machine-lan-ip>:9090/v1`
- **API Key**:
  - If `requireApiKey=false` (default): any API key value may be used by clients — authentication is not enforced.
  - If `requireApiKey=true`: clients must send `Authorization: Bearer <apiKey>`.
- **Model**: The ID shown in the proxy sidebar (e.g., `gpt-5.3-codex`)

### List Models (curl)

Without auth:

```cmd
curl http://127.0.0.1:9090/v1/models
```

With auth enabled:

```cmd
curl http://127.0.0.1:9090/v1/models -H "Authorization: Bearer YOUR_API_KEY"
```

LAN access with auth:

```cmd
curl http://192.168.x.x:9090/v1/models -H "Authorization: Bearer YOUR_API_KEY"
```

### Chat Completion (curl)

```cmd
curl http://127.0.0.1:9090/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"gpt-5.3-codex\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello!\"}]}"
```

### Content Parts (curl)

```cmd
curl http://127.0.0.1:9090/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"gpt-5.3-codex\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Hello!\"}]}]}"
```

### Image Input (curl)

For models with image support, send a data URL (replace the base64 placeholder with actual image data):

```cmd
curl http://127.0.0.1:9090/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"gpt-5.3-codex\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,iVBOR...\"}},{\"type\":\"text\",\"text\":\"What is in this image?\"}]}]}"
```

> Only data URLs are supported. Remote image URLs (`https://...`) return HTTP 400.

### Python Example

```python
from openai import OpenAI

# If auth is disabled (default):
client = OpenAI(base_url="http://127.0.0.1:9090/v1", api_key="sk-test")

# If auth is enabled:
client = OpenAI(base_url="http://127.0.0.1:9090/v1", api_key="YOUR_API_KEY")

response = client.chat.completions.create(
    model="gpt-5.3-codex",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/models` | List available models |
| POST | `/v1/chat/completions` | Chat completion (streaming and non-streaming) |

## Configuration

### VS Code Settings

Open extension settings via:

- `Ctrl+Shift+P` → **GitHub Copilot OpenAI Proxy: Open Settings**
- Or manually: **File → Preferences → Settings** → search for `vscode-copilot-openai-proxy`

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `vscode-copilot-openai-proxy.port` | integer | `9090` | Local HTTP API server port (valid range: 1–65535). Invalid values fall back to `9090`. |
| `vscode-copilot-openai-proxy.host` | string | `"127.0.0.1"` | Host/interface to bind to. `127.0.0.1` for local-only (default, secure). `0.0.0.0` to listen on all interfaces (LAN access). Valid IPv4/IPv6 addresses are accepted. Invalid values fall back to `127.0.0.1`. |
| `vscode-copilot-openai-proxy.autoStart` | boolean | `true` | Automatically start the proxy server when the extension activates. Set to `false` to start manually via the sidebar. |
| `vscode-copilot-openai-proxy.requireApiKey` | boolean | `false` | Require `Authorization: Bearer <apiKey>` on protected endpoints. |
| `vscode-copilot-openai-proxy.apiKey` | string | `""` | API key for Bearer authentication. Send as `Authorization: Bearer <apiKey>`. Do not share this value. |
| `vscode-copilot-openai-proxy.callHistoryRetentionDays` | integer | `10` | Number of days to keep call history records. Expired entries are cleaned up automatically. |
| `vscode-copilot-openai-proxy.toolChoicePolicy` | string | `"bestEffort"` | Controls how the bridge handles OpenAI `tool_choice` values. See [Tool Choice Policy](#tool-choice-policy). |

**Important:** Changing `host` or `port` requires restarting the bridge server (stop and start again). `requireApiKey`, `apiKey`, and `toolChoicePolicy` are read per request, so changes take effect immediately without restarting.

### Tool Choice Policy

The VS Code Language Model API cannot directly enforce OpenAI `tool_choice` values like `required` or specific function calls. The `toolChoicePolicy` setting controls how the bridge handles these cases:

| Policy | Behavior |
|--------|----------|
| `bestEffort` | Forwards `tools` and returns a valid response even if required tool calls are missing. This is the default and works with all clients. |
| `strictPreflight` | Rejects required/specific `tool_choice` before calling the backend, because the VS Code LM API cannot enforce it. Returns a `tool_choice_not_enforceable` error. |
| `strictAfterResponse` | Allows the backend call, but rejects non-streaming responses when required `tool_calls` are missing. Returns a `required_tool_call_missing` error. |

> **Streaming note:** `strictAfterResponse` is not fully enforceable for streaming requests and behaves as best effort with diagnostics.

### How Autostart Works

- On extension activation, if `autoStart` is `true` (the default), the server starts automatically on the configured port.
- If `autoStart` is `false`, the extension activates but the server remains stopped until you click **Start Server** in the sidebar.
- Manual start/stop via the sidebar always works regardless of the `autoStart` setting.
- If the server is already running, activation will not attempt a duplicate start.

## LAN / Network Usage

To expose the bridge to your local network:

1. Open VS Code Settings and search for `vscode-copilot-openai-proxy`.
2. Set **Host** to `0.0.0.0`.
3. Set **Require Api Key** to `true`.
4. Set **Api Key** to a strong token (e.g., generate with `openssl rand -hex 32`).
5. Restart the bridge server (stop + start).
6. Other devices on your LAN can now connect:
   ```
   Client base URL: http://<host-machine-lan-ip>:9090/v1
   ```
   With header: `Authorization: Bearer <your-token>`

**Important:**

- `0.0.0.0` is a bind address, not a client URL. Clients must use the host machine's actual LAN IP.
- LAN exposure without authentication is unsafe. A warning is logged on server start when `host=0.0.0.0` and `requireApiKey=false`.
- Windows Firewall may need to allow inbound access to the configured port.
- Do not expose this bridge to untrusted networks.

## Sidebar

The sidebar panel displays:

| Section | Description |
|---------|-------------|
| **Server Status** | Running/stopped status, host, port, base URL, network base URL (when applicable), auth status, and autostart state |
| **Server URL** | Local base URL (e.g., `http://127.0.0.1:9090/v1`) and network base URL (when bound to `0.0.0.0`) with copy buttons |
| **API-key Auth Status** | One of: `disabled`, `enabled, configured`, or `enabled, missing key`. The actual API key is never shown. |
| **Active Language Model** | Model selector dropdown with refresh button |
| **Model Metadata** | ID, name, vendor, family, version, max input tokens, and pricing info for the selected model |
| **Raw Model Metadata** | All enumerable properties from the VS Code `LanguageModelChat` object as formatted JSON. Includes copy button and collapse/expand toggle. Sensitive-looking fields are automatically redacted. |
| **Verbose Logging** | Checkbox to enable verbose request/response logging |
| **Start / Stop Server** | Toggle the proxy server on or off |
| **Open Settings** | Opens the VS Code settings page for this extension |
| **Quick Copy** | Copy buttons for local base URL, network base URL, models endpoint, and cURL commands |
| **Current Session Metrics** | Live in-memory metrics: request counts, endpoint breakdowns, streaming counts, token totals, average latency, per-model breakdown. Includes reset button. |
| **Recent Calls** | 10 most recent call history entries with timestamp, endpoint, model, status, latency, streaming, and token usage. Buttons to show full history or clear history. |

The port and host are **not** editable in the sidebar — change them through VS Code settings:

- `Ctrl+Shift+P` → **GitHub Copilot OpenAI Proxy: Open Settings**
- Or click **Open Settings** in the sidebar

Additional sidebar settings persisted in VS Code workspace state:

| Setting | Default | Description |
|---------|---------|-------------|
| Model | (first available) | VS Code Language Model to route requests to |
| Verbose Logging | `false` | Log full request/response bodies to output channel |

## OpenAI Compatibility

### Supported Request Fields

| Field | Behavior |
|-------|----------|
| `messages` with string content | Pass-through |
| `messages` with `text` content parts | Concatenated to plain text |
| `messages` with `input_text` content parts | Concatenated to plain text |
| `messages` with `image_url` / `input_image` / `image` data URL parts | Accepted for models with `supportsImageToText` capability |
| `tools` | Mapped to VS Code Language Model tool definitions |
| `tool_choice` | Accepted; forwarded to VS Code LM API when supported |
| `role: "tool"` | Converted to a user message with `[Tool Result for {id}]` prefix |
| `assistant` with `tool_calls` | Tool call information serialized as text context for the model |

### Known Limitations

- Remote image URLs (`http://...`, `https://...`) return HTTP 400 — only data URLs are supported
- Unsupported content types (`audio`, `file`, `video`, binary) return HTTP 400
- The selected model in the sidebar processes ALL requests, regardless of the `model` field in incoming requests
- System messages are prepended to the first user message (VS Code LM API has no system role)
- Token counting uses `model.countTokens()` and may not match OpenAI's tokenizer exactly
- JSON body limit is 10 MB
- Default bind host is `127.0.0.1` — network binding is optional via `host=0.0.0.0` or a concrete LAN IP
- API-key authentication is optional and disabled by default
- If auth is disabled, clients can call all endpoints without an `Authorization` header
- If auth is enabled, protected endpoints require `Authorization: Bearer <apiKey>`
- VS Code LM API cannot directly enforce OpenAI `tool_choice` — use `toolChoicePolicy` to control behavior
- Remote image URLs are not supported; only data URLs are supported

### Error Shapes

All errors return OpenAI-compatible JSON:

```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error",
    "code": "..."
  }
}
```

## Privacy / Security

- Call history is **metadata-only** — no prompts, responses, request bodies, or response bodies are stored
- Image data and base64 payloads are **never persisted** — only a boolean `imageInput` flag is recorded
- API keys and Authorization headers are **not stored** in call history
- API keys are **not logged**
- The webview displays auth status (`disabled`, `enabled, configured`, `enabled, missing key`) but **never shows the actual API key**
- LAN exposure without authentication is unsafe — a warning is logged when `host=0.0.0.0` and `requireApiKey=false`
- Use authentication when binding to non-local interfaces
- Session metrics are **in-memory only** and lost on VS Code restart

## Pricing

- Pricing is derived **only** from raw model metadata fields when present
- AIC fields are displayed as **AICs** (AI Credits), not USD
- No USD conversion is performed unless metadata explicitly provides USD
- No external pricing lookup is performed
- If no pricing fields exist in the raw metadata, pricing shows as `Not provided by available model metadata`

### Cost Estimation

The extension provides estimated USD cost for chat completion requests when model pricing metadata is available.

#### How Cost Is Calculated

Model pricing metadata exposes cost fields in **AICs (AI Credits) per 1M tokens**:

| Field | Meaning | Example |
|-------|---------|---------|
| `inputCost` | AICs per 1M input tokens | `300` |
| `outputCost` | AICs per 1M output tokens | `1500` |
| `cacheCost` | AICs per 1M cached input tokens | `30` |

#### AIC-to-USD Conversion

```
USD per 1M tokens = AIC value / 100
```

For example:
- `inputCost: 300` → `$3.00 / 1M input tokens`
- `outputCost: 1500` → `$15.00 / 1M output tokens`
- `cacheCost: 30` → `$0.30 / 1M cached input tokens`

#### Per-Request Cost

```
inputCostUsd  = promptTokens     / 1,000,000 × inputUsdPer1M
outputCostUsd = completionTokens / 1,000,000 × outputUsdPer1M
totalCostUsd  = inputCostUsd + outputCostUsd
```

Example with `claude-sonnet-4.5` (`inputCost=300`, `outputCost=1500`):

```
Prompt tokens:     4,409
Completion tokens:    11

Input:  4,409 / 1,000,000 × $3.00  = $0.013227
Output:    11 / 1,000,000 × $15.00 = $0.000165
Total:                              = $0.013392
```

#### Where Cost Is Displayed

| Location | What |
|----------|------|
| **Current Session Metrics** | Total estimated input/output/total cost for the session |
| **Per-Model Metrics** | Per-model cost breakdown with pricing rate |
| **Recent Calls** | Per-request cost if available, or "unknown" |
| **Output Channel** (`Show Session Metrics` command) | Cost summary with per-model breakdown |

#### Limitations

- Cost is **estimated** only — it may not match actual billing
- Cost is only available when both **token usage** and **pricing metadata** are available
- The `auto` model selection may not always have resolvable pricing if the effective model is unknown
- Cached token costs are only calculated when cached token count data is available (not currently exposed by the VS Code LM API)
- Pricing metadata availability depends on what VS Code / GitHub Copilot exposes at runtime
- No external pricing lookup is performed — all pricing comes from the model object

## Call History

The extension records **metadata-only** call history for every request. History persists across VS Code restarts and is stored in the extension's global storage directory as a JSON file.

Each history entry includes: unique ID, timestamp, HTTP method, endpoint, model name, status code, success/failure, latency, streaming flag, and token usage.

Entries older than `callHistoryRetentionDays` (default: 10) are automatically cleaned up on extension activation and before writing new entries. A hard cap of 1000 entries is also enforced.

| Command | Description |
|---------|-------------|
| `GitHub Copilot OpenAI Proxy: Show Call History` | Display recent call history in an output channel (newest first) |
| `GitHub Copilot OpenAI Proxy: Clear Call History` | Delete all call history (requires confirmation) |

## Session Metrics

In-memory session metrics track cumulative request data for the current VS Code session. Metrics are **not persisted** across VS Code restarts and are independent from the persistent call history.

Tracked metrics include: request counts (total/successful/failed), endpoint breakdowns, streaming vs non-streaming counts, token totals, average latency, last request/model/error, and per-model breakdown.

| Command | Description |
|---------|-------------|
| `GitHub Copilot OpenAI Proxy: Show Session Metrics` | Display current session metrics in an output channel |

| Aspect | Call History | Session Metrics |
|--------|-------------|-----------------|
| **Storage** | JSON file in global storage | In-memory only |
| **Persistence** | Survives VS Code restarts | Lost on restart |
| **Retention** | Configurable (default 10 days) | Current session only |
| **Content** | Individual entry records | Aggregate totals + per-model breakdown |

## Development

```cmd
npm install
npm run compile
npm run lint
npm run bundle
npm run test:auth
npm run test:host-config
npm run test:settings
npm run test:compat
npx @vscode/vsce package
```

> `npm run test:compat` requires the extension/server to be running in VS Code on the configured port (default: 9090).
> `npm run test:auth`, `npm run test:host-config`, and `npm run test:settings` run standalone without a server.

## Compatibility Tests

The project includes an OpenAI-compatible API test suite that verifies the local proxy behaves like a standard OpenAI API.

### Prerequisites

- The extension must be installed and activated in VS Code.
- The server must be running on the configured port (default: 9090).
- At least one GitHub Copilot / VS Code Language Model must be available.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_HOST` | `127.0.0.1` | Target host to test against |
| `PROXY_PORT` | `9090` | Target port to test against |
| `PROXY_API_KEY` | (empty) | If set, sends `Authorization: Bearer <key>` on all requests |

### Running Tests

Default (local, no auth):

```cmd
npm run test:compat
```

Custom port:

```cmd
set PROXY_PORT=8080 && node scripts/test-compat.mjs
```

LAN host:

```cmd
set PROXY_HOST=192.168.x.x && set PROXY_PORT=9090 && node scripts/test-compat.mjs
```

With auth:

```cmd
set PROXY_API_KEY=YOUR_API_KEY && node scripts/test-compat.mjs
```

LAN + auth:

```cmd
set PROXY_HOST=192.168.x.x && set PROXY_PORT=9090 && set PROXY_API_KEY=YOUR_API_KEY && node scripts/test-compat.mjs
```

### What Is Tested

| Test Suite | Endpoint | Checks |
|------------|----------|--------|
| A | `GET /v1/models` | HTTP 200, JSON shape (`object: "list"`, `data` array, model fields) |
| B | `POST /v1/chat/completions` (non-streaming) | HTTP 200, JSON shape (`id`, `object: "chat.completion"`, `choices`, `message.role`) |
| C | `POST /v1/chat/completions` (streaming) | HTTP 200, SSE content type, `data:` chunks, `[DONE]` sentinel |
| D | Various invalid requests | Non-2xx errors, server stability after bad requests |
| E | Call history compatibility | API remains OpenAI-compatible after multiple sequential calls |
| F | Message content normalization | String, `text` array, `input_text` array, `role:tool`, unsupported `audio`/malformed content returns 400 |
| G | Agent compatibility | `role:tool`, `assistant` with `tool_calls`, `tools`, `tool_choice:auto`/function, error shapes, 400 for remote image URLs |
| H | Image input compatibility | Data URL image accepted for capable models, remote URL returns 400, invalid data URL/MIME returns 400, no base64 data in errors |

### Limitations

- Tests require a running server (the extension must be active in VS Code).
- Tests depend on available GitHub Copilot / VS Code LM models.
- The test script uses the first available model from `GET /v1/models`.

## Fork Notice

This project is a fork of [vanlylabs/vsc-lm-api-bridge](https://github.com/vanlylabs/vsc-lm-api-bridge).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) for details.
