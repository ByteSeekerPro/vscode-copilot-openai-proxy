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

## Focused Test Commands

No focused test commands discovered. The test infrastructure uses `@vscode/test-electron` which launches a VS Code instance. Individual test targeting would depend on Mocha's `--grep` flag but is not configured in the scripts.

## Manual / Integration Test Scripts

| Command | Description | Prerequisites |
|---|---|---|
| `npm run test:compat` | OpenAI compatibility test suite (`scripts/test-compat.mjs`) | Server must be running on configured port |
| `set PROXY_PORT=8080 && node scripts/test-compat.mjs` | Compatibility tests on custom port | Server must be running on that port |

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

All runtime configuration is managed through the sidebar UI and persisted in VS Code workspace state. There are no `.env` files or external config files.

| Setting | Default | Description |
|---|---|---|
| Port | `9090` | Local HTTP server port |
| Model | (first available) | VS Code Language Model to route requests to |
| Verbose Logging | `false` | Log full request/response bodies to output channel |
