# Change Workflow

## General Principles

1. Read the relevant agent docs first ([`AGENTS.md`](../../AGENTS.md)).
2. Identify the minimum set of files to change.
3. Make the smallest possible change that solves the problem.
4. Verify before and after.

## Bug Fixes

1. Read [`architecture-map.md`](architecture-map.md) to identify the relevant module.
2. Read only the file(s) involved in the bug.
3. Run `npm run compile && npm run test` to confirm current state.
4. Implement the fix.
5. Run `npm run compile && npm run test` again.
6. If the bug involves the HTTP API, test manually with `bash scripts/test-service.sh` (requires running server).

## New Features

1. Read [`architecture-map.md`](architecture-map.md) to understand where the feature fits.
2. Read [`coding-conventions.md`](coding-conventions.md) for style guidance.
3. Identify which modules need changes — typically one of:
   - New API endpoint → `src/server.ts`
   - New message handling → `src/lmBridge.ts`
   - New config option → `src/extension.ts` + `src/webview/provider.ts` + `src/webview/main.js`
4. Run `npm run compile && npm run test` before starting.
5. Implement changes.
6. Run `npm run compile && npm run test` after.
7. If UI was changed, test in Extension Development Host (`F5`).

## Refactoring

1. Run `npm run compile && npm run test` to establish baseline.
2. Make incremental changes — one file or one function at a time.
3. Run `npm run compile && npm run test` after each increment.
4. Do not change public interfaces (method signatures, message types) unless necessary.
5. Preserve all existing behavior.

## Documentation Changes

1. Only modify documentation files (`.md`).
2. No build/test verification needed for docs-only changes.
3. Keep documentation factual — do not document planned behavior as current behavior.

## Verification Expectations

| Change Type | Required Verification |
|---|---|
| Any `src/` change | `npm run compile && npm run test` |
| HTTP API change | Manual test with running server |
| Webview UI change | Manual test in Extension Development Host |
| `package.json` change | `npm run compile` to verify no breakage |
| Docs only | No verification needed |

## Reporting After Changes

After making changes, report:
1. Files modified and what changed in each.
2. Test results (pass/fail).
3. Any new risks or concerns introduced.
4. Whether existing behavior was preserved.
