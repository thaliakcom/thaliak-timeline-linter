# Game data through ironworks-cli

## Focus

Implement `.agents/plans/2026-10-26-ironworks-integration.md`: opt-in game data (names, descriptions, fields and icons of actions and statuses) through a user-installed `ironworks-cli`.

## Actions

- Step 1: explored `ironworks-cli` (CLI, schema handling, icon output), `thaliak/src/eleventy/utility/ironworks.ts`, `thaliak/.cache` and the linter. Measured CLI cost in WSL. Decisions are recorded in the plan; the user added: show all listed action fields with enum names, recache statuses/actions on game updates (own cache only), inline status icons in the editor, and the status game description.
- Settings `ironworksPath`, `gameDirectory`, `cachePath` (`package.json`); `client/src/extension.ts` passes them as `initializationOptions.ironworks` and restarts the server when they change.
- `server/src/ironworks.ts`: runner with probe (one warning, then off), disk cache in thaliak's `.cache` layout, in-memory memo, process limit, game-version expiry.
- `server/src/game-text.ts`: Markdown for status and action game data; enum tables copied from thaliak's `data.ts`.
- Hovers (`hover-provider.ts`, now async) append the game data with the icon as a data URI.
- Tree: `outline-provider.ts` (now async) sets status icon paths and per-row tooltips (`tooltip`, `tooltipIcon`); the client builds tooltips lazily in `resolveTreeItem`, so the outline response doesn't carry base64 icons.
- Inline icons: request `thaliak/statusIcons` (`server/src/status-icon-provider.ts`) and `client/src/status-decorations.ts`. Drawn as a CSS background on a 1em `before` box (injected through `textDecoration`), because `contentIconPath` renders at the PNG's natural 48×64 size.
- README section on game data.
- Verified: `npm run check-types`, eslint (only the pre-existing `while (true)` error in `outline-view.ts`), esbuild, and a scratch harness against the real CLI (status 628, action 7535, name override, unknown ID, stack icon, wrong game dir, missing CLI, feature off, cache expiry).

- User review 1 (game data worked without a reload):
  - Tooltips rebuilt as a port of thaliak's (`server/src/tooltip.ts`, replacing `game-text.ts`), following `transform-value.ts`, `templates.ts` and `processAction()`/`processStatus()` in `data.ts`. Header table: icon, name (timeline `name`, else capitalized game name unless encrypted `_rsv…`, else the key), caption suffix, caption with caption icons, info (cast, damage, stacks, tick, duration). Then the description (resolve/tips/mistakes/trivia, children list for actions; user description then game description for statuses), then the raw game fields. Icon 405 (`DEFAULT_IMAGE`) is dropped, as in thaliak.
  - Caption effect range is padded by the caster's hitbox (`source` → `BNpcBase`/`ModelSkeleton`, added to the runner).
  - Templates in tooltip text are resolved (names, status icons with stacks, enum names, `:d`, `[fight]`, `[boss]`); unknown ones and `i:` sub-icons show as code. Each line of author text is its own paragraph, like thaliak.
  - Thaliak's caption images (player/enemy, damage types, elements) copied to `media/caption`.
  - Hovers enable HTML (`markdown.supportHtml`). Tree tooltips are fetched on hover through `thaliak/tooltip` (`resolveTreeItem`), so they're identical to hovers.
  - Inline icons: after the colon on status definitions; box enlarged to 1em × 1.35em.
  - Verified with a harness rendering `m12s1.yaml` tooltips against the real CLI; visual rendering untested.

- User review 2: the header shows only the name line and the caption line; thaliak's additional information (cast, damage, stacks, tick, duration) moved to the bottom section with the game fields, code-styled. Names that templates were replaced with are coloured `#e6dcff` (`<span style="color:…;">`, the only styling hover HTML allows besides `background-color`).

## Status

Completed; awaiting the user's checks in VS Code (plan step 6): tree icons and tooltips, hovers, inline icon rendering, behaviour without the CLI, first-run cost.
