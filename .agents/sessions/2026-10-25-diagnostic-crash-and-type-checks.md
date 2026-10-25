# 2026-10-25: Diagnostic crash on open, type checking

## Task

Fix `textDocument/diagnostic failed: a[j].includes is not a function` when opening a timeline
(e.g. `ultimates/top.yaml`); afterwards, look into inlay hints not showing next to timestamps.

## Actions

- Root cause: `checkLook`/`checkImage` in `server/src/linter-rules.ts` called `.includes()`/`.join()` on the
  lists of `enums/looks.yaml`, which are maps (look → parameters), not arrays. Fixed with
  `Object.hasOwn()`/`Object.keys()`.
- Why `tsc` didn't catch it: root `check-types` ran `tsc --noEmit` on the root tsconfig, which includes a
  nonexistent `src` and whose `references` plain `tsc` ignores, so nothing was checked. `check-types` and
  `watch:tsc` now run against `client` and `server` tsconfigs.
- Bumped TypeScript to 6 (iterator helper types). Under TS 6: `skipLibCheck` in both tsconfigs (`@types/node`
  18 and `vscode-jsonrpc` d.ts mismatch the libs), `strict: false` pinned for the client (TS 6 defaults to
  strict), Mocha default import in `client/src/test/index.ts` (esModuleInterop always on).
- Type checking surfaced a second bug: `checkAnimations` looked up `in`/`out` instead of `enter`/`exit` in
  `enums/animations.yaml`, so it never reported anything. Fixed.
- Searched for `for…in` over a `Set` (user suspicion): none found.
- Verified with a stdio LSP probe (scratch, outside the repo): the installed 0.3.0 bundle reproduces the
  error on `top.yaml`; the fixed bundle returns 38 diagnostics. Both return 56 inlay hints, so the server
  side of inlay hints works; the cause of them not rendering is client/editor side and still undiagnosed.
- Patch queue of 3 commits prepared (`git stage-patches`).

Notes: `client/src/test` e2e harness is dead (`npm test` expects an emitted `client/out`, nothing emits it).

## Status

Completed (crash fix and type checks). Inlay hint rendering: open, awaiting observations from the user.
