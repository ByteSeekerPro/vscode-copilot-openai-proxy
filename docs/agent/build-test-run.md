# Build, Test, and Run

## Prerequisites

- Node.js (compatible with VS Code extension host)
- npm
- VS Code (for running the extension)
- GitHub Copilot Chat extension (`github.copilot-chat`) installed and enabled in VS Code

## Build Commands

| Command | Description | Verified |
|---|---|---|
| `npm install` | Install dependencies | Needs verification |
| `npm run compile` | Compile TypeScript to `out/` via `tsc` | Needs verification |
| `npm run bundle` | Bundle with tsup (minified CJS, external vscode) to `out/` | Needs verification |
| `npm run watch` | Watch mode with tsup | Needs verification |
| `npm run package` | Package as `.vsix` file via `vsce` | Needs verification |

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
| `npm run pretest` | Compile + lint | Needs verification |
| `npm run test` | Run Mocha tests via `@vscode/test-electron` | Needs verification |
| `npm run lint` | ESLint on `src/` | Needs verification |

The test runner entry point is `out/test/runTest.js` (referenced in [`package.json`](package.json:63)). Inferred, not verified — no test files were found in `src/`.

## Focused Test Commands

No focused test commands discovered. The test infrastructure uses `@vscode/test-electron` which launches a VS Code instance. Individual test targeting would depend on Mocha's `--grep` flag but is not configured in the scripts.

## Manual / Integration Test Scripts

| Command | Description | Prerequisites |
|---|---|---|
| `bash scripts/test-service.sh` | curl-based API test (tests `/v1/models`) | Server must be running |
| `cd scripts && uv run test-langchain.py` | LangChain integration test (auto-detects model) | Server must be running, `uv` installed |
| `cd scripts && uv run test-langchain.py --stream` | Also test streaming | Same as above |

## Lint / Format

| Command | Description | Verified |
|---|---|---|
| `npm run lint` | ESLint with `@typescript-eslint` | Needs verification |

No Prettier or other formatter configuration found.

## Safe Commands for Agents

These commands are safe to run without side effects:

- `npm run compile` — read-only compilation
- `npm run lint` — static analysis only
- `npm run test` — runs tests (may launch a VS Code instance)
- `npm run pretest` — compile + lint

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
