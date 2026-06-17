# Build, Test, and Run

## Prerequisites

- Node.js (compatible with VS Code extension host)
- npm
- VS Code (for running the extension)
- GitHub Copilot Chat extension (`github.copilot-chat`) installed and enabled in VS Code

## Build Commands

| Command | Description | Verified |
|---|---|---|
| `npm install` | Install dependencies | Verified |
| `npm run compile` | Compile TypeScript to `out/` via `tsc` | Verified |
| `npm run bundle` | Bundle with tsup (minified CJS, external vscode) to `out/` | Verified |
| `npm run watch` | Watch mode with tsup | Verified |
| `npm run package` / `npx @vscode/vsce package` | Package as `.vsix` file via `vsce` | Verified |

## Run / Start

The extension runs inside VS Code's Extension Development Host:

1. Open the project folder in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. In the new VS Code window, open the **Copilot OpenAI Proxy** sidebar panel.
4. Select a model and click **Start Server**.
5. Server is available at `http://127.0.0.1:{port}/v1` (default port: `9090`).

There is no standalone CLI run mode — the extension requires the VS Code host.

## Test Commands

| Command | Description | Verified |
|---|---|---|
| `npm run pretest` | Compile + lint | Verified |
| `npm run test` | Bundle (same as `npm run bundle`) | Verified |
| `npm run lint` | ESLint on `src/` | Verified |
| `npm run test:compat` | Run OpenAI compatibility tests against running server | Verified (requires running server) |
| `npm run test:auth` | Run API-key authentication unit tests | Verified |
| `npm run test:settings` | Run package.json settings validation tests | Verified |

## Focused Test Commands

| Command | Description |
|---|---|
| `npm run test:host-config` | Run host configuration unit tests (standalone, no server) |
| `npm run test:auth` | Run API-key authentication unit tests (standalone, no server) |
| `npm run test:settings` | Run package.json settings validation tests (standalone, no server) |

## Manual / Integration Test Scripts

| Command | Description | Prerequisites |
|---|---|---|
| `npm run test:compat` | OpenAI compatibility test suite (`scripts/test-compat.mjs`) | Server must be running on configured port |
| `set PROXY_PORT=8080 && node scripts/test-compat.mjs` | Compatibility tests on custom port | Server must be running on that port |
| `set PROXY_API_KEY=YOUR_KEY && node scripts/test-compat.mjs` | Compatibility tests with API key auth | Server must be running with `requireApiKey` enabled |
| `set PROXY_HOST=192.168.x.x && set PROXY_API_KEY=YOUR_KEY && node scripts/test-compat.mjs` | LAN compatibility tests with auth | Server must be bound to `0.0.0.0` with `requireApiKey` enabled |

### Environment Variables for `test-compat.mjs`

| Variable | Default | Description |
|---|---|---|
| `PROXY_HOST` | `127.0.0.1` | Target host to test against |
| `PROXY_PORT` | `9090` | Target port to test against |
| `PROXY_API_KEY` | (empty) | If set, sends `Authorization: Bearer <key>` on all requests |

### Compatibility Test Examples

**Local, no auth (default):**
```bash
node scripts/test-compat.mjs
```

**Local with auth:**
```bash
set PROXY_API_KEY=YOUR_API_KEY && node scripts/test-compat.mjs
```

**LAN host with auth:**
```bash
set PROXY_HOST=192.168.x.x && set PROXY_API_KEY=YOUR_API_KEY && node scripts/test-compat.mjs
```

**Custom port, LAN host, with auth:**
```bash
set PROXY_HOST=192.168.x.x && set PROXY_PORT=9090 && set PROXY_API_KEY=YOUR_API_KEY && node scripts/test-compat.mjs
```

## Lint / Format

| Command | Description | Verified |
|---|---|---|
| `npm run lint` | ESLint with `@typescript-eslint` | Needs verification |

No Prettier or other formatter configuration found.

## Safe Commands for Agents

These commands are safe to run without side effects:

- `npm run compile` — read-only compilation
- `npm run lint` — static analysis only
- `npm run test` — bundles (same as `npm run bundle`)
- `npm run pretest` — compile + lint
- `npm run test:compat` — runs compatibility tests (requires running server)

## Commands Requiring Caution

| Command | Risk |
|---|---|
| `npm run bundle` | Overwrites `out/` directory |
| `npm run package` | Creates `.vsix` file in project root |
| `npm install` | Modifies `node_modules/` and `package-lock.json` |

## Configuration

All runtime configuration is managed through the **VS Code Settings UI** and the sidebar panel. There are no `.env` files or external config files.

### VS Code Settings UI

Open settings by searching for `@ext:ByteSeekerPro.vscode-copilot-openai-proxy` in the VS Code Settings UI (File → Preferences → Settings, or `Ctrl+,`).

The following settings are available:

| Setting key | Default | Description |
|---|---|---|
| `autoStart` | `true` | Automatically start the proxy server on extension activation |
| `callHistoryRetentionDays` | `10` | Days to keep call history records |
| `port` | `9090` | Local HTTP server port |
| `host` | `127.0.0.1` | Host/interface to bind to. `127.0.0.1` for local-only (default, secure). `0.0.0.0` to listen on all interfaces (LAN access). Valid IPv4/IPv6 addresses are accepted. Invalid values fall back to `127.0.0.1`. |
| `toolChoicePolicy` | `bestEffort` | Controls how the bridge handles OpenAI `tool_choice` values |
| `requireApiKey` | `false` | Require `Authorization: Bearer <apiKey>` on protected endpoints |
| `apiKey` | `""` | API key for Bearer authentication. Send as `Authorization: Bearer <apiKey>`. Do not share this value. |

**Important:** Changing `host` or `port` requires restarting the bridge server (stop and start again). `requireApiKey` and `apiKey` are read per request, so changes take effect immediately without restarting.

### LAN Example

To expose the bridge to your local network:

1. Open VS Code Settings and search for `vscode-copilot-openai-proxy`.
2. Set **Host** to `0.0.0.0`.
3. Set **Require Api Key** to `true`.
4. Set **Api Key** to a strong token (e.g. generate with `openssl rand -hex 32`).
5. Restart the bridge server (stop + start).
6. Other devices on your LAN can now connect:
   ```
   Client base URL: http://<host-machine-lan-ip>:9090/v1
   ```
   With header: `Authorization: Bearer <your-token>`

### Authentication Usage

**Without auth (default):**
```bash
curl -s http://127.0.0.1:9090/v1/models
```

**With auth enabled:**
```bash
curl -s http://127.0.0.1:9090/v1/models -H "Authorization: Bearer YOUR_API_KEY"
```

**LAN access with auth:**
```bash
curl -s http://192.168.x.x:9090/v1/models -H "Authorization: Bearer YOUR_API_KEY"
```

**Security notes:**
- When `host=0.0.0.0` and `requireApiKey=false`, a security warning is logged on server start.
- API keys and Authorization header values are never logged or stored in call history.
- The webview displays auth status (disabled / enabled, configured / enabled, missing key) but never shows the actual key.
