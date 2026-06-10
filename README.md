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

- Local OpenAI-compatible API at `http://127.0.0.1:9090/v1` (configurable port)
- `GET /v1/models` — list available models
- `POST /v1/chat/completions` — streaming and non-streaming chat completions
- Sidebar UI with server status, model selection, metadata display, and call history
- Configurable port and autostart
- Model metadata and raw model metadata display
- AIC pricing display when raw metadata provides it
- Metadata-only call history (prompts and responses are never persisted)
- In-memory session metrics
- OpenAI agent compatibility: `tools`, `tool_choice`, `role: tool`, assistant `tool_calls`
- Image input support for data URL images on image-capable models
- OpenAI compatibility test script

## Installation

### From VSIX

```cmd
code --install-extension vscode-copilot-openai-proxy-1.0.1.vsix
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
- **API Key**: Any string (e.g., `sk-test`) — authentication is not enforced
- **Model**: The ID shown in the proxy sidebar (e.g., `copilot-gpt-4o`)

### List Models (curl)

```cmd
curl http://127.0.0.1:9090/v1/models
```

### Chat Completion (curl)

```cmd
curl http://127.0.0.1:9090/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"copilot-gpt-4o\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello!\"}]}"
```

### Content Parts (curl)

```cmd
curl http://127.0.0.1:9090/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"copilot-gpt-4o\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Hello!\"}]}]}"
```

### Image Input (curl)

For models with image support, send a data URL (replace the base64 placeholder with actual image data):

```cmd
curl http://127.0.0.1:9090/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"copilot-gpt-4o\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,iVBOR...\"}},{\"type\":\"text\",\"text\":\"What is in this image?\"}]}]}"
```

> Only data URLs are supported. Remote image URLs (`https://...`) return HTTP 400.

### Python Example

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:9090/v1", api_key="sk-test")

response = client.chat.completions.create(
    model="copilot-gpt-4o",
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
| `vscode-copilot-openai-proxy.autoStart` | boolean | `true` | Automatically start the proxy server when the extension activates. Set to `false` to start manually via the sidebar. |
| `vscode-copilot-openai-proxy.callHistoryRetentionDays` | integer | `10` | Number of days to keep call history records. Expired entries are cleaned up automatically. |

### How Autostart Works

- On extension activation, if `autoStart` is `true` (the default), the server starts automatically on the configured port.
- If `autoStart` is `false`, the extension activates but the server remains stopped until you click **Start Server** in the sidebar.
- Manual start/stop via the sidebar always works regardless of the `autoStart` setting.
- If the server is already running, activation will not attempt a duplicate start.

## Sidebar

The sidebar panel displays:

| Section | Description |
|---------|-------------|
| **Server Status** | Running/stopped status, effective port, base URL, and autostart state |
| **Server URL** | Base URL (e.g., `http://127.0.0.1:9090/v1`) with a copy button |
| **Active Language Model** | Model selector dropdown with refresh button |
| **Model Metadata** | ID, name, vendor, family, version, max input tokens, and pricing info for the selected model |
| **Raw Model Metadata** | All enumerable properties from the VS Code `LanguageModelChat` object as formatted JSON. Includes copy button and collapse/expand toggle. Sensitive-looking fields are automatically redacted. |
| **Verbose Logging** | Checkbox to enable verbose request/response logging |
| **Start / Stop Server** | Toggle the proxy server on or off |
| **Open Settings** | Opens the VS Code settings page for this extension |
| **Quick Copy** | Copy buttons for base URL, models endpoint, and a cURL command |
| **Current Session Metrics** | Live in-memory metrics: request counts, endpoint breakdowns, streaming counts, token totals, average latency, per-model breakdown. Includes reset button. |
| **Recent Calls** | 10 most recent call history entries with timestamp, endpoint, model, status, latency, streaming, and token usage. Buttons to show full history or clear history. |

The port is **not** editable in the sidebar — change it through VS Code settings:

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
- Server binds to `127.0.0.1` only (not exposed to network)
- No authentication — any API key string is accepted

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

## Privacy

- Call history is **metadata-only** — no prompts, responses, request bodies, or response bodies are stored
- Image data and base64 payloads are **never persisted** — only a boolean `imageInput` flag is recorded
- API keys and authorization headers are **not stored** by call history
- Session metrics are **in-memory only** and lost on VS Code restart

## Pricing

- Pricing is derived **only** from raw model metadata fields when present
- AIC fields are displayed as **AICs** (AI Credits), not USD
- No USD conversion is performed unless metadata explicitly provides USD
- No external pricing lookup is performed
- If no pricing fields exist in the raw metadata, pricing shows as `Not provided by available model metadata`

## Development

```cmd
npm install
npm run compile
npm run bundle
npm run test
npm run test:compat
npx @vscode/vsce package
```

> `npm run test:compat` requires the extension/server to be running in VS Code on the configured port (default: 9090).

## Compatibility Tests

The project includes an OpenAI-compatible API test suite that verifies the local proxy behaves like a standard OpenAI API.

### Prerequisites

- The extension must be installed and activated in VS Code.
- The server must be running on the configured port (default: 9090).
- At least one GitHub Copilot / VS Code Language Model must be available.

### Running Tests

```cmd
npm run test:compat
```

For a custom port:

```cmd
set PROXY_PORT=8080 && node scripts/test-compat.mjs
```

On PowerShell:

```powershell
$env:PROXY_PORT = 8080; node scripts/test-compat.mjs
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

## Fork Notice

This project is a fork of [vanlylabs/vsc-lm-api-bridge](https://github.com/vanlylabs/vsc-lm-api-bridge).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) for details.
