# Coding Conventions

## Language and Runtime

- TypeScript targeting ES2022, compiled to CommonJS modules.
- Strict mode enabled (`strict: true` in [`tsconfig.json`](tsconfig.json:10)).
- `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` are all enabled.

## Naming Patterns

| Element | Convention | Example |
|---|---|---|
| Classes | PascalCase | `LmBridge`, `Server`, `SidebarProvider` |
| Methods (public) | camelCase | `getModels()`, `start()`, `stop()` |
| Methods (private) | underscore prefix | `_refreshModels()`, `_getHtmlForWebview()`, `_postStatusUpdate()` |
| Interfaces | PascalCase, no `I` prefix | `State` |
| Constants / config | camelCase | `outputChannel`, `verboseLogging` |
| Files | camelCase | `lmBridge.ts`, `provider.ts` |

## Error Handling

- `try/catch` blocks around async operations with error messages logged to `outputChannel`.
- HTTP errors returned as `{ error: message }` with status 500.
- Server startup errors propagate via Promise rejection.
- Server stop uses a 3-second timeout fallback to prevent hanging.

## Module Pattern

- Each module exports a single class or a single `activate`/`deactivate` function.
- Dependencies are injected via constructor parameters.
- The extension creates all instances in `activate()` and wires them together.

## Async Patterns

- `async/await` for Promise-based operations.
- `AsyncIterable` / `async *` generators for streaming responses.
- Promises wrapped around Node.js callbacks (e.g., `app.listen()`).

## Webview Communication

- Extension host → webview: `webview.postMessage({ type, payload })`.
- Webview → extension host: `vscode.postMessage({ type, payload })`.
- Message types: `start`, `stop`, `updateState`, `refreshModels`, `statusUpdate`, `models`, `error`.

## Import Style

- `import * as vscode from 'vscode'` for VS Code API.
- Named imports for project modules: `import { LmBridge } from './lmBridge'`.
- Default imports for Express: `import express from 'express'`.

## Generated Code Rules

- `out/` is generated — never edit directly.
- Webview HTML is generated as a template string in `_getHtmlForWebview()` — any UI change requires modifying this template.

## General Rule

Follow existing style in nearby files. When in doubt, match the patterns in `src/server.ts` and `src/lmBridge.ts`.
