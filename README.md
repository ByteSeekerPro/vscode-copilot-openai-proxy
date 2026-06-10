# GitHub Copilot OpenAI Proxy

A VS Code extension that exposes GitHub Copilot / VS Code Language Model API models through a local OpenAI-compatible HTTP API. This allows agent tools, coding assistants, and OpenAI-compatible clients to access available GitHub Copilot models.

## Use Cases

- **Agent tools** — give AI coding agents access to Copilot models via a standard API
- **Coding assistants** — integrate with tools that speak the OpenAI API format
- **Local experiments** — test prompts and model behavior against your Copilot models
- **OpenAI-compatible clients** — use any tool that supports the OpenAI `/v1/chat/completions` endpoint

## Tech Stack

- **Language**: TypeScript (Node.js, ES2022 target)
- **HTTP Server**: Express with CORS
- **Extension API**: VS Code Extension API (`vscode.lm`)
- **Webview UI**: VS Code Webview Toolkit (`@vscode-elements/elements`), Codicons
- **Bundler**: tsup
- **Runtime Dependency**: GitHub Copilot Chat extension (`github.copilot-chat`)

## Build

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Bundle for distribution
npm run bundle

# Package as .vsix
npm run package
```

## Run

1. Open the project in VS Code.
2. Launch the extension (press `F5` to open the Extension Development Host).
3. In the Extension Development Host, open the **Copilot OpenAI Proxy** sidebar panel.
4. Select a model and click **Start Server** (or enable autostart in settings).
5. The server starts on `http://127.0.0.1:{port}/v1` (default port: 9090).

Any application configured to use the OpenAI API can now connect:

- **Base URL**: `http://127.0.0.1:9090/v1`
- **API Key**: Any string (e.g., `sk-test`)
- **Model**: The ID shown in the proxy sidebar (e.g., `copilot-gpt-4o`)

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

## Compatibility Tests

The project includes an OpenAI-compatible API test suite that verifies the local proxy behaves like a standard OpenAI API.

### Prerequisites

- The extension must be installed and activated in VS Code.
- The server must be running on the configured port (default: 9090).
- At least one GitHub Copilot / VS Code Language Model must be available.

### Running Tests

```bash
# Default port (9090)
npm run test:compat

# Custom port
set PROXY_PORT=8080 && node scripts/test-compat.mjs
```

On PowerShell use:
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
| G | Zoo Code / Agent compatibility | `role:tool`, `assistant` with `tool_calls`, `tools`, `tool_choice:auto`/function, error shapes, 400 for remote image URLs |
| H | Image input compatibility | Data URL image accepted for capable models, remote URL returns 400, invalid data URL/MIME returns 400, no base64 data in errors |

### Limitations

- Tests require a running server (the extension must be active in VS Code).
- Tests depend on available GitHub Copilot / VS Code LM models. If no models are available, chat completion tests will fail.
- The test script uses the first available model from `GET /v1/models`. If no models are available, a fallback model name is used (which may cause a 500 error).

## Configuration

### VS Code Settings

Open extension settings via:

- `Ctrl+Shift+P` → **GitHub Copilot OpenAI Proxy: Open Settings**
- Or manually: **File → Preferences → Settings** → search for `vscode-copilot-openai-proxy`

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `vscode-copilot-openai-proxy.port` | integer | `9090` | Local HTTP API server port (valid range: 1–65535). Invalid values fall back to `9090`. |
| `vscode-copilot-openai-proxy.callHistoryRetentionDays` | integer | `10` | Number of days to keep call history records. Expired entries are cleaned up automatically. |
| `vscode-copilot-openai-proxy.autoStart` | boolean | `true` | Automatically start the proxy server when the extension activates. Set to `false` to start manually via the sidebar. |

### How Autostart Works

- On extension activation, if `autoStart` is `true` (the default), the server starts automatically on the configured port.
- If `autoStart` is `false`, the extension activates but the server remains stopped until you click **Start Server** in the sidebar.
- Manual start/stop via the sidebar always works regardless of the `autoStart` setting.
- If the server is already running, activation will not attempt a duplicate start.

### Sidebar UI

The sidebar panel displays the following sections:

| Section | Description |
|---------|-------------|
| **Server Status** | Shows running/stopped status, effective port, base URL, and autostart state |
| **Server URL** | Displays the base URL (e.g., `http://127.0.0.1:9090/v1`) with a copy button. The port is configured through VS Code settings — see the hint in the sidebar. |
| **Active Language Model** | Model selector dropdown with refresh button |
| **Model Metadata** | Displays ID, name, vendor, family, version, max input tokens, and pricing info for the selected model |
| **Raw Model Metadata** | Shows all enumerable properties from the VS Code `LanguageModelChat` object as formatted JSON. Useful for diagnosing what the VS Code Language Model API actually exposes at runtime. Includes a copy button and collapse/expand toggle. Sensitive-looking fields (tokens, secrets, passwords) are automatically redacted. Pricing is only shown if the API provides pricing metadata. |
| **Verbose Logging** | Checkbox to enable verbose request/response logging |
| **Start / Stop Server** | Toggle the proxy server on or off |
| **Open Settings** | Opens the VS Code settings page for this extension |
| **Quick Copy** | Copy buttons for base URL, models endpoint, and a cURL command |
| **Current Session Metrics** | Live in-memory metrics since extension activation: total/successful/failed requests, endpoint breakdowns, streaming counts, token totals, average latency, last request/model/error. Includes per-model breakdown and a reset button. |
| **Recent Calls** | Shows the 10 most recent call history entries with timestamp, endpoint, model, status, latency, streaming, and token usage. Includes buttons to show full history or clear history. |

The port is **not** editable in the sidebar — change it through VS Code settings:

- `Ctrl+Shift+P` → **GitHub Copilot OpenAI Proxy: Open Settings**
- Or click **Open Settings** in the sidebar

Additional sidebar settings persisted in VS Code workspace state:

| Setting | Default | Description |
|---------|---------|-------------|
| Model | (first available) | VS Code Language Model to route requests to |
| Verbose Logging | `false` | Log full request/response bodies to output channel |

## Call History

The extension records **metadata-only** call history for every request handled by the proxy. History persists across VS Code restarts and is stored in the extension's global storage directory as a JSON file.

### What Is Recorded

Each history entry includes:

- Unique ID and timestamp
- HTTP method and endpoint path
- Model name (if available)
- HTTP status code
- Success/failure status
- Latency in milliseconds
- Whether streaming was used
- Token usage (prompt / completion / total) if available
- Short error message on failure

### What Is **Not** Recorded

- Full request bodies
- Full response bodies
- Full prompt text
- Full completion/assistant text
- Full messages array
- API keys or authorization headers

### Commands

| Command | Description |
|---------|-------------|
| `GitHub Copilot OpenAI Proxy: Show Call History` | Display recent call history in an output channel (newest first) |
| `GitHub Copilot OpenAI Proxy: Clear Call History` | Delete all call history (requires confirmation) |
| `GitHub Copilot OpenAI Proxy: Show Session Metrics` | Display current session metrics in an output channel |

### Retention

Entries older than the configured number of days (`callHistoryRetentionDays`, default: 10) are automatically cleaned up on extension activation and before writing new entries. A hard cap of 1000 entries is also enforced to prevent unbounded growth.

### Privacy Note

Prompts and responses are never persisted. Only non-sensitive metadata is stored.

## Session Metrics

The extension tracks **in-memory** session metrics for the current VS Code session. These metrics are **not persisted** across VS Code restarts. They are independent from the persistent call history.

### What Is Tracked

- Session start timestamp
- Total / successful / failed request counts
- Endpoint breakdown (`/v1/models` count, `/v1/chat/completions` count)
- Streaming vs non-streaming request counts
- Total prompt, completion, and combined token counts (shown as "Unknown" if not reported)
- Average latency across all requests
- Last request timestamp, model, and error summary
- Per-model breakdown: request count, success/failure, token usage, average latency

### Sidebar Display

The **Current Session Metrics** section in the sidebar shows a live view of all session metrics and a per-model breakdown table. It includes:

- **Refresh Metrics** button: manually refresh the metrics display
- **Reset Session Metrics** button: clears all in-memory session metrics (with confirmation). Does **not** affect persistent call history.

### Command

| Command | Description |
|---------|-------------|
| `GitHub Copilot OpenAI Proxy: Show Session Metrics` | Display current session metrics in an output channel as text |

### Difference: Persistent Call History vs In-Memory Session Metrics

| Aspect | Call History | Session Metrics |
|--------|-------------|-----------------|
| **Storage** | JSON file in global storage | In-memory only |
| **Persistence** | Survives VS Code restarts | Lost on restart |
| **Retention** | Configurable (default 10 days) | Current session only |
| **Scope** | All recorded entries (up to 1000) | Aggregated counters + per-model breakdown |
| **Clearable** | Yes (Clear History) | Yes (Reset Session Metrics) |
| **Content** | Individual entry records | Aggregate totals |

## Raw Model Metadata

The sidebar includes a **Raw Model Metadata** section that displays all enumerable properties from the selected VS Code `LanguageModelChat` object as formatted JSON.

### Purpose

This view helps diagnose what metadata the VS Code Language Model API actually exposes at runtime. It may reveal additional fields beyond the standard `id`, `name`, `vendor`, `family`, `version`, and `maxInputTokens`.

### Pricing Behavior

Pricing information is derived from raw model metadata fields when present. The extension does **not** invent, fetch, or estimate pricing data. It checks for the following fields on the `LanguageModelChat` object:

| Field | Example | Display |
|-------|---------|---------|
| `inputCost` | `25` | `25 AICs/1M tokens` |
| `outputCost` | `200` | `200 AICs/1M tokens` |
| `cacheCost` | `2` | `2 AICs/1M tokens` |
| `priceCategory` | `"low"` | `low` |
| `pricing` | `"In: 25 · Out: 200 AICs/1M tokens"` | Raw string |

- Values are displayed as **AICs** (AI Credits) unless the metadata explicitly provides a USD unit.
- No external pricing lookups or AIC-to-USD conversions are performed.
- If no pricing fields exist in the raw metadata, the pricing row shows `Not provided by available model metadata`.
- The Raw Model Metadata section continues to show all original fields regardless.

### Safety

- Sensitive-looking field names (containing `token`, `secret`, `password`, `authorization`, etc.) have their values automatically redacted as `[redacted]`.
- The original model object is never mutated.
- Functions, symbols, undefined values, and circular references are handled gracefully.

## Key Entry Points

- **Extension activation**: [`src/extension.ts`](src/extension.ts:12) — `activate()` function
- **HTTP server**: [`src/server.ts`](src/server.ts:7) — Express routes for OpenAI-compatible API
- **LM Bridge** ([`src/lmBridge.ts`](src/lmBridge.ts:3)): Maps OpenAI API calls to VS Code Language Model API
- **Call History** ([`src/callHistory.ts`](src/callHistory.ts:1)): Persistent metadata-only call history store
- **Session Metrics** ([`src/sessionMetrics.ts`](src/sessionMetrics.ts:1)): In-memory session metrics store and safe serializer
- **Sidebar UI**: [`src/webview/provider.ts`](src/webview/provider.ts:5) — Webview panel provider

## OpenAI Agent Compatibility

The proxy accepts standard OpenAI message formats used by agents such as Zoo Code, LangChain, and similar tools.

### Supported Message Content Formats

| Format | Example | Behavior |
|--------|---------|----------|
| Plain string | `"content": "hello"` | Pass-through |
| Text array | `"content": [{"type":"text","text":"hello"}]` | Concatenated to plain text |
| Input text array | `"content": [{"type":"input_text","text":"hello"}]` | Concatenated to plain text |
| Empty/null | `"content": null` | Treated as empty string |
| Mixed text parts | Multiple `text`/`input_text` parts | Concatenated |
| Image (data URL) | `"content": [{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}]` | Accepted for models with `supportsImageToText` capability |
| Image (remote URL) | `"content": [{"type":"image_url","image_url":{"url":"https://..."}}]` | Returns HTTP 400 (remote fetching not yet supported) |

### Supported Agent Fields

| Field | Behavior |
|-------|----------|
| `role: "tool"` | Converted to a user message with `[Tool Result for {id}]` prefix |
| `tools` | Mapped to VS Code Language Model tool definitions |
| `tool_choice` | Accepted without crashing; forwarded to VS Code LM API when supported |
| `assistant` with `tool_calls` | Tool call information serialized as text context for the model |

### Image Input Support

Models whose raw metadata includes `capabilities.supportsImageToText: true` accept image content parts. The proxy maps OpenAI-style `image_url` content parts to VS Code `LanguageModelDataPart.image()`.

#### Supported Image Content Part Shapes

| Shape | Example |
|-------|---------|
| `image_url` | `{ "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }` |
| `input_image` | `{ "type": "input_image", "image_url": { "url": "data:image/png;base64,..." } }` |
| `image` | `{ "type": "image", "url": "data:image/png;base64,..." }` |

#### Supported Image Sources

| Source | Behavior |
|--------|----------|
| Data URL (`data:image/...;base64,...`) | Parsed and sent as binary image data to the VS Code LM API |
| Remote URL (`https://...`) | **Not yet supported.** Returns HTTP 400 with a clear message requesting a data URL. |

#### Supported Image MIME Types

`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/bmp`, `image/tiff`

#### Unsupported Image Behavior

If the selected model does **not** support image input, or the image data is invalid, the proxy returns HTTP 400 with an OpenAI-compatible error:

```json
{
  "error": {
    "message": "The selected model does not support image input...",
    "type": "invalid_request_error",
    "code": "unsupported_image_input"
  }
}
```

Error cases include:
- Model without `supportsImageToText` receiving image parts
- Remote HTTP/HTTPS image URLs (not yet supported)
- Invalid data URLs (not valid base64)
- Unsupported MIME types (e.g. `image/svg+xml`)
- Missing image URL in content part

#### Privacy Note

Image data is **never** stored in call history. Only a boolean `imageInput` flag is recorded to indicate whether the request included image content. Full base64 payloads, image URLs, and image binary data are not persisted or logged.

### Unsupported Content

Content types such as `audio`, `file`, and other non-text/non-image parts return HTTP 400 with an OpenAI-compatible error shape. For models without image support, `image_url` parts also return 400:

```json
{
  "error": {
    "message": "Unsupported content part type \"audio\"...",
    "type": "invalid_request_error",
    "code": "unsupported_image_input"
  }
}
```

### Body Size Limit

The JSON body limit is set to **10 MB** to accommodate agent requests with large conversation histories. Requests exceeding this limit return HTTP 413.

## Development Notes

- The server binds to `127.0.0.1` only (not exposed to network).
- The extension requires the `github.copilot-chat` extension to be installed and enabled.
- The model selected in the sidebar is the model that actually processes requests, regardless of the model name in the incoming API request.
- Tool calls (function calling) are supported and mapped to VS Code Language Model tools.
- System messages from the OpenAI format are prepended to the first user message, as VS Code Language Model API does not support a separate system role.
- Assistant messages with `content: null` and `tool_calls` are accepted without crashing.
- Image input (`image_url`, `input_image`, `image` content parts) is supported for models with `supportsImageToText` capability, using data URLs only.
- Remote image URLs (http/https) are not yet supported and return HTTP 400.
- Unsupported content types (audio, file, binary) return HTTP 400, not 500.
- Image data is never stored in call history; only a metadata flag is recorded.

## Fork Notice

This project is a fork of [vanlylabs/vsc-lm-api-bridge](https://github.com/vanlylabs/vsc-lm-api-bridge).
