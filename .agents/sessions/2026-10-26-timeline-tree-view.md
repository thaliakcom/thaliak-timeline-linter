# Timeline tree view and section lines

## Focus

Implement `.agents/plans/2026-10-26-timeline-tree-view.md`: a Thaliak activity bar tree view of the active timeline (status, actions, timeline by phase, graphing) and section lines in the editor.

## Actions

- Step 1 (spike): PNG icons, shape SVGs and all planned codicons render in tree rows (checked by the user). Spike code removed.
- Step 2: wire types in `server/src/types/outline.ts` and `client/src/outline-types.ts`; request `thaliak/outline` registered in `server.ts`.
- Step 3: `server/src/outline-provider.ts`. `formatTime` moved from `inlay-hint-provider.ts` to `util.ts`. Checked with a scratch script on `top.yaml`, `m2s.yaml` and the CRLF `uwu.yaml`. Find All References returns nothing for graph keys (existing gap in `reference-provider.ts`, not fixed per plan).
- Timeline children expanded under timeline items use the child's entry in the parent action as their range and click target.
- Step 4: `client/src/outline-view.ts`, activity bar container, view, welcome text and inline buttons in `package.json`. Activity bar icon `media/activity-bar.svg` is the thaliak favicon in `currentColor` (fill layer at 35% opacity).
- Step 5: `client/src/outline-icons.ts`.
  - `media/shapes/`: 12 shape icons redrawn from `thaliak/www/images/shapes` with solid fills and real strokes instead of gradients and the glow filter, plus a new `in-or-out.svg` (circle top left, donut bottom right, split diagonally). `defamation` reuses the circle.
  - `media/markers/`: the 13 deleted marker SVGs (thaliak `ff346075^`), frozen at a frame by pausing the SMIL animations in a browser and writing the animated values back as static attributes. Frames (fraction of the loop, agreed with the user): exaflare 0.1, proximity 0.6, spread-circle 0.8, rotate-cw 0.2, rotate-ccw 0.1, all others 0. Not yet simplified for 16 px (strokes as thin as the originals).
  - Markers without an icon in `media/markers` (e.g. added later) get the `pin` codicon.
  - Status rows only use `media/status/generic.svg` and `media/status/dot.svg` (for `type: dot`). In-game status icons were dropped by the user: a status ID doesn't identify one icon, and reading game data belongs to a separate `ironworks-cli` integration work package (to be planned separately).
- Icon fixes after the user's review:
  - Marker SVGs rendered blank because each declared `xmlns:xlink` twice (invalid XML, introduced when staging them); fixed.
  - `media/status/generic.svg` deleted. Statuses without `type: dot` use the codicon `symbol-event` (lightning bolt), actions without a shape `symbol-method`, steps `list-ordered`.
  - Section headers get codicons by key (`SECTION_CODICONS` in `outline-icons.ts`): status `pulse`, actions `flame`, timeline `history`, graphing and graphs `graph`, elements `symbol-misc`. The `section` outline icon now carries the section key (`name`).
  - Untyped elements with the key `boss` or `enemy` use `media/boss.svg` (copy of `thaliak/www/images/boss.svg`); the `element` outline icon now carries the element key.
- Second review fixes:
  - Tree stayed empty when VS Code started with a timeline already active. Suspected cause (not confirmed): the first `thaliak/outline` request ran before the client had started or before the server had the document. The first refresh now waits for `client.start()`, and the server sends `thaliak/documentOpened` from `documents.onDidOpen` for non-enum documents; the client refreshes when it's the active document.
  - `media/boss.svg`: the two black strokes are now `#f2f2f2` (readable on dark themes).
  - `media/markers/circle-kb.svg`: solid `#e3be92` strokes, 3 wide, viewBox cropped to `12 12 76 76`.
- Step 6: `client/src/section-lines.ts`, a whole-line top border at `status:`, `actions:`, `graphing:`, each graph and each phase. Scrollbar marks removed at the user's request (too strong, same colour as hint diagnostics).
- `npm run compile` passes. Visual checks of the icons are left to the user.

## Status

Completed (waiting for the user's check of the icons in VS Code).
