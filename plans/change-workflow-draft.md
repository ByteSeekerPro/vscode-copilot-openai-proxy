# Change Workflow — Draft

> Detailed procedures for making, verifying, and reporting changes.
> See also: [`AGENTS.md`](../../AGENTS.md) for the concise quick-reference version.

## General Principles

1. Read the relevant agent docs first ([`AGENTS.md`](../../AGENTS.md)).
2. Identify the minimum set of files to change.
3. Make the smallest possible change that solves the problem.
4. Verify before and after.
5. Never claim tests passed without actually running them.

---

## Startup Procedure

For every task:

1. Read [`AGENTS.md`](../../AGENTS.md).
2. Read only the [`docs/agent/`](.) files relevant to the task type:
   - Bug fix → [`architecture-map.md`](architecture-map.md) + [`known-risks.md`](known-risks.md)
   - New feature → [`architecture-map.md`](architecture-map.md) + [`coding-conventions.md`](coding-conventions.md)
   - Refactor → [`coding-conventions.md`](coding-conventions.md) + [`known-risks.md`](known-risks.md)
   - Docs only → no further agent docs needed
3. Identify the minimum set of source files to read.
4. Run the baseline verification: `npm run compile && npm run test`.
5. If the task is unclear, produce a plan before reading more source files.

---

## Source Loading Discipline

- Do NOT scan the entire repository.
- Use [`architecture-map.md`](architecture-map.md) → "Common Change Areas and First Files to Inspect" table.
- Start with 1–3 source files maximum.
- Expand scope only when the task requires it.
- If context exceeds ~4000 lines of source, stop and summarize what you know.
- If unsure which files matter, produce a plan before reading more.

---

## Bug Fixes

1. Read [`architecture-map.md`](architecture-map.md) to identify the relevant module.
2. Read only the file(s) involved in the bug.
3. Run `npm run compile && npm run test` to confirm current state.
4. Implement the fix — smallest correct change only.
5. Run `npm run compile && npm run test` again.
6. If the bug involves the HTTP API, test manually with `bash scripts/test-service.sh` (requires running server).

---

## New Features

1. Read [`architecture-map.md`](architecture-map.md) to understand where the feature fits.
2. Read [`coding-conventions.md`](coding-conventions.md) for style guidance.
3. Identify which modules need changes — typically one of:
   - New API endpoint → [`src/server.ts`](../../src/server.ts)
   - New message handling → [`src/lmBridge.ts`](../../src/lmBridge.ts)
   - New config option → [`src/extension.ts`](../../src/extension.ts) + [`src/webview/provider.ts`](../../src/webview/provider.ts) + [`src/webview/main.js`](../../src/webview/main.js)
4. Run `npm run compile && npm run test` before starting.
5. Implement changes — one module at a time when possible.
6. Run `npm run compile && npm run test` after.
7. If UI was changed, test in Extension Development Host (`F5`).

---

## Refactoring

1. Run `npm run compile && npm run test` to establish baseline.
2. Make incremental changes — one file or one function at a time.
3. Run `npm run compile && npm run test` after each increment.
4. Do not change public interfaces (method signatures, message types) unless necessary.
5. Preserve all existing behavior.
6. Do not mix refactoring with feature work or bug fixes.

---

## Debug Workflow

1. **Reproduce** — Confirm the failure exists. If it cannot be reproduced, document the attempt.
2. **Read first** — Read failing test output, error messages, or logs before editing any code.
3. **Identify root cause** — Trace the failure to its origin. Check:
   - Which module owns the failing behavior (use [`architecture-map.md`](architecture-map.md)).
   - Whether the issue is in data flow, API translation, or HTTP formatting.
4. **Fix the root cause** — Do not patch symptoms. Do not add `try/catch` to hide errors.
5. **Verify** — Run `npm run compile && npm run test`.
6. **Regression check** — If the fix touches `server.ts` or `lmBridge.ts`, test manually with `bash scripts/test-service.sh`.

---

## Test Workflow

### Automated Tests

```bash
npm run compile && npm run test
```

- Run before changes (baseline) and after changes (verification).
- Tests use `@vscode/test-electron` which launches a VS Code instance.
- If `npm run test` fails to find test files, the test infrastructure may be incomplete (see [`known-risks.md`](known-risks.md) "Gaps").

### Lint

```bash
npm run lint
```

- Safe to run. Read-only static analysis.
- Fix any lint errors introduced by your changes.

### Manual / Integration Tests

| Command | When to use |
|---------|-------------|
| `bash scripts/test-service.sh` | After changing HTTP API behavior (`server.ts`) |
| `cd scripts && uv run test-langchain.py` | After changing LM bridge behavior (`lmBridge.ts`) |

### Test Rules

- Do not claim tests passed unless they were actually run.
- If commands are inferred but not verified, say so explicitly.
- If the test infrastructure is broken, report it — do not skip verification silently.

---

## Safety Boundaries

### Never do without explicit approval:

- Run destructive commands (`rm -rf`, `DROP TABLE`, etc.)
- Deploy or publish
- Modify secrets, `.env`, or credentials
- Rewrite generated files (`out/`, `package-lock.json`)
- Upgrade dependencies
- Run broad formatting or linting fixes across multiple files
- Make large multi-file changes (more than 5 files)
- Add new npm dependencies

### Always safe:

- `npm run compile` — read-only compilation
- `npm run lint` — static analysis only
- `npm run test` — runs tests (launches VS Code instance)
- Reading any source file

---

## Documentation Changes

1. Only modify documentation files (`.md`).
2. No build/test verification needed for docs-only changes.
3. Keep documentation factual — do not document planned behavior as current behavior.
4. If marking something "Needs verification", use that exact phrase.

---

## Verification Expectations

| Change Type | Required Verification |
|---|---|
| Any `src/` change | `npm run compile && npm run test` |
| HTTP API change | Manual test with running server |
| Webview UI change | Manual test in Extension Development Host |
| `package.json` change | `npm run compile` to verify no breakage |
| Docs only | No verification needed |

---

## Reporting Format

After completing a task, provide a structured report:

```markdown
### Files Changed
- `src/server.ts` — Added X endpoint for Y
- `docs/agent/known-risks.md` — Documented new risk Z

### Commands Run
- `npm run compile && npm run test` — pass
- `bash scripts/test-service.sh` — pass

### Test Result
- [ ] Pass / [ ] Fail / [ ] Not run (reason: ...)

### Risks
- None / Description of new risks or remaining concerns

### Next Step
- Suggested follow-up action
```

---

## What Not to Change Casually

These areas are fragile — see [`known-risks.md`](known-risks.md) for details:

- [`package.json`](../../package.json) `contributes` section — breaks extension registration
- [`src/webview/provider.ts`](../../src/webview/provider.ts) `_getHtmlForWebview()` — single template string for entire UI
- [`src/server.ts`](../../src/server.ts) socket tracking (`_sockets` set) — removing it causes port leaks
- [`src/lmBridge.ts`](../../src/lmBridge.ts) `mapMessages()` — system message prepending is a deliberate workaround
