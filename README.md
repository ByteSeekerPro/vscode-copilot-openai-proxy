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
4. Select a model and click **Start Server**.
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

### Sidebar UI Settings

Additional settings are managed through the sidebar UI and persisted in VS Code workspace state:

| Setting | Default | Description |
|---------|---------|-------------|
| Port | (from VS Code settings) | Local HTTP server port |
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

### Retention

Entries older than the configured number of days (`callHistoryRetentionDays`, default: 10) are automatically cleaned up on extension activation and before writing new entries. A hard cap of 1000 entries is also enforced to prevent unbounded growth.

### Privacy Note

Prompts and responses are never persisted. Only non-sensitive metadata is stored.

## Key Entry Points

- **Extension activation**: [`src/extension.ts`](src/extension.ts:12) — `activate()` function
- **HTTP server**: [`src/server.ts`](src/server.ts:7) — Express routes for OpenAI-compatible API
- **LM Bridge** ([`src/lmBridge.ts`](src/lmBridge.ts:3)): Maps OpenAI API calls to VS Code Language Model API
- **Call History** ([`src/callHistory.ts`](src/callHistory.ts:1)): Persistent metadata-only call history store
- **Sidebar UI**: [`src/webview/provider.ts`](src/webview/provider.ts:5) — Webview panel provider

## Development Notes

- The server binds to `127.0.0.1` only (not exposed to network).
- The extension requires the `github.copilot-chat` extension to be installed and enabled.
- The model selected in the sidebar is the model that actually processes requests, regardless of the model name in the incoming API request.
- Tool calls (function calling) are supported and mapped to VS Code Language Model tools.
- System messages from the OpenAI format are prepended to the first user message, as VS Code Language Model API does not support a separate system role.

## Fork Notice

This project is a fork of [vanlylabs/vsc-lm-api-bridge](https://github.com/vanlylabs/vsc-lm-api-bridge).
