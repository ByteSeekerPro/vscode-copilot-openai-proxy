# AGENTS.md — Draft

> Read this file at the start of every task. Follow the steps in order.

## 1. Startup

1. Read this file ([`AGENTS.md`](AGENTS.md)).
2. Read only the [`docs/agent/`](docs/agent/) files relevant to the task:
   - [`project-overview.md`](docs/agent/project-overview.md) — what the project is
   - [`architecture-map.md`](docs/agent/architecture-map.md) — how code connects
   - [`build-test-run.md`](docs/agent/build-test-run.md) — build and test commands
   - [`coding-conventions.md`](docs/agent/coding-conventions.md) — style rules
   - [`change-workflow.md`](docs/agent/change-workflow.md) — how to make changes
   - [`known-risks.md`](docs/agent/known-risks.md) — fragile areas
   - [`glossary.md`](docs/agent/glossary.md) — domain terms
3. Identify the minimum set of source files to inspect. Start with 1–3 files.
4. If the task is unclear, produce a plan before reading more files.

## 2. Source Loading

- Do NOT scan the entire repository.
- Use [`architecture-map.md`](docs/agent/architecture-map.md) → "Common Change Areas" to find first files.
- Stop reading and summarize if context exceeds ~4000 lines of source.
- If unsure which files matter, ask before reading more.

## 3. Change Discipline

- Prefer the smallest correct change.
- Do not perform unrelated cleanup.
- Do not mix refactoring with feature work.
- Do not introduce dependencies without approval.
- Do not change public behavior unless explicitly required.
- Do not modify webview UI unless the task is about the UI.
- Preserve existing patterns. Match style of nearby code.

## 4. Build and Test

Primary verification chain:

```
npm run compile && npm run test
```

- Run this **before** making changes (establish baseline).
- Run this **after** making changes (verify no breakage).
- If commands are inferred but not verified, say so — do not claim tests passed.

See [`build-test-run.md`](docs/agent/build-test-run.md) for all available commands.

## 5. Debug Workflow

1. Reproduce or inspect the failure first.
2. Read failing tests or logs before editing code.
3. Identify root cause before changing anything.
4. Do not patch symptoms. Do not add `try/catch` to hide errors.
5. See [`change-workflow.md`](docs/agent/change-workflow.md) for the full debug procedure.

## 6. Safety

**Never do these without explicit approval:**

- Run destructive commands (`rm -rf`, `DROP TABLE`, etc.)
- Deploy or publish
- Modify secrets, `.env`, or credentials
- Rewrite generated files (`out/`, `package-lock.json`)
- Upgrade dependencies
- Run broad formatting or linting fixes across multiple files
- Make large multi-file changes (more than 5 files)

## 7. Report Format

After completing a task, report:

| Section | Content |
|---------|---------|
| Files changed | List each file and a one-line summary of what changed |
| Commands run | Exact commands executed |
| Test result | Pass / Fail / Not run (with reason) |
| Risks | Any new risks introduced or remaining concerns |
| Next step | Suggested follow-up action |

## Files Overview

| File | Purpose |
|------|---------|
| [`src/extension.ts`](src/extension.ts) | Extension entry point, state management, component wiring |
| [`src/server.ts`](src/server.ts) | Express HTTP server, OpenAI-compatible routes |
| [`src/lmBridge.ts`](src/lmBridge.ts) | OpenAI API ↔ VS Code Language Model API translation |
| [`src/webview/provider.ts`](src/webview/provider.ts) | Sidebar webview provider |
| [`src/webview/main.js`](src/webview/main.js) | Webview client-side logic |
| [`src/webview/style.css`](src/webview/style.css) | Webview styles |
| [`package.json`](package.json) | Extension manifest, scripts, dependencies |
