# Agent Instructions

## Read First

1. [`docs/agent/project-overview.md`](docs/agent/project-overview.md) — what this project is and its structure
2. [`docs/agent/architecture-map.md`](docs/agent/architecture-map.md) — how the code is organized and connected
3. [`docs/agent/build-test-run.md`](docs/agent/build-test-run.md) — how to build, test, and run
4. [`docs/agent/coding-conventions.md`](docs/agent/coding-conventions.md) — style and patterns to follow
5. [`docs/agent/change-workflow.md`](docs/agent/change-workflow.md) — how to make and verify changes
6. [`docs/agent/known-risks.md`](docs/agent/known-risks.md) — fragile areas and pitfalls
7. [`docs/agent/glossary.md`](docs/agent/glossary.md) — domain terms and concepts

## Source-Loading Discipline

- **Do NOT read the entire repository by default.**
- Start with the file(s) directly relevant to your task.
- Use `project-overview.md` and `architecture-map.md` to identify which files to read.
- Only expand scope if the task requires it.

## Safe Workflow

1. Read the relevant agent docs listed above.
2. Identify the minimum set of files to inspect for your task.
3. Run existing tests before making changes: `npm run compile && npm run test`.
4. Make the smallest possible change that solves the problem.
5. Re-run tests after changes.
6. Do not modify files outside `src/` unless the task explicitly requires it.

## Change Philosophy

- Prefer small, focused changes over large refactors.
- Do not change behavior unless the task requires it.
- Do not add dependencies unless necessary and justified.
- Do not modify the webview UI unless the task is specifically about the UI.
- When in doubt, preserve existing patterns.
