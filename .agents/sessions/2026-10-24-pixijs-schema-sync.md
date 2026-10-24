# Sync with thaliak's pixijs branch (diagram schema changes)

**Task:** Integrate the diagram schema changes from thaliak's `pixijs` branch: `action:` on graphing elements (completion, unresolved-action error), the build-time diagram checks from `src/eleventy/data-extensions/yaml.ts` and `src/eleventy/utility/data.ts`, and remove or narrow the auto-attack validator. Then (step two) assess what else the extension could do for timeline authors.

**Actions:**
- Copied `src/types/{enum-schema,raids,graphing,enums}.ts` from the local thaliak `pixijs` checkout. `get-objects.mjs` now also fetches `enums.ts`, which `graphing.ts` imports.
- `LinterOptions.enums` gained `animations` and `looks` (`enums/animations.yaml`, `enums/looks.yaml`; the parser cache already loads every enum file by name).
- `action:` values under `graphing.elements` are an `a:` symbol in `getSymbolAt()`, so hover, go to definition and prepare-rename work on them. References and rename include them (`getElementActions()` in `util.ts`). Completion offers only the file's own actions, because the build resolves `action` against `fight.actions` only.
- New rule `validateDiagramElements` ports `processGraphing()`: donut size order, `in`/`out` animation per element type, `color`/`width` ignored by non-`plain` looks (tracking looks set by earlier steps), `look` per element type, old marker image URLs, `margin` outside the arena, unresolved `action`, donut sized by an action without `size`. The unresolved-action error is reported even when `size` is set (the build skips that case).
- New rule `mustSpecifyArena` (`arena` required unless `wip` includes `timeline`).
- `mustSpecifyAutoAttacks` is skipped for fights with more than one `<phase>` item that has `hp` (ultimates, whose `autos` the data repo forbids).
- Not ported (need game data or image files): `effectRange`/`XAxisModifier` checks, the raidwide `effectRange >= 50` check, the arena margin vs. image size check.
- Verified with a scratch harness (bundled with `server.ts` stubbed) over all timelines in `thaliak/_site/_data` and two synthetic fixtures: every new diagnostic fires on its fixture; real timelines get no new diagram errors; `top.yaml`/`uwu.yaml` no longer get `missing-auto-attacks`. `tsc -p server` shows only the 6 pre-existing errors. Not tested inside VS Code.
- Unquoted flow-sequence step keys (`[M2,T2]: {...}`) parse as sequences in the `yaml` library; the rule joins them with `,` like js-yaml does in the build.
- Found: the root `npm run check-types` (`tsc --noEmit` with the root tsconfig) checks no files; `tsc -p server` does. `mustSpecifyPartyHP` suppresses on wip `damage`, the build on wip `timeline`. thaliak's `processGraphing()` passes the message location (`where`) to `isDonut()` for steps, so its step donut-size check only runs for keys containing `#`.

**Step two (assessment, no code):** surveyed the 136 timelines (scratch script), the data repo's wiki, `AGENTS.md`, timeline-review skill and past reviews. Candidates, roughly by value:
- Game data from thaliak's `.cache/actions|status/<id>.json` when present: hover/inlay names on `id:`, and the remaining build checks (redundant `name`/`type`/`element`, encrypted names, castType vs `shape`, raidwide `effectRange`, element sizing, stack counts).
- Document symbols (outline/breadcrumbs) for actions, statuses, phases and timeline items; inlay hints for `at` as mm:ss.
- Unused actions (18 found) as unnecessary-tagged hints; unused statuses are noisy (128, mostly `damage-down`).
- Author's Guide wording hints with quick fixes ("party member(s)" 91, "apply" 38, "affected players" 5, "do damage" 4; "will" 480 is too noisy).
- Build errors still missing: last child with `link`, `Placeholder description`.
- Strategy key / graph ID completion and orphan graph warnings (2 found).

The user rejected the game-data cache (only works for one person) and the outline (the Red Hat YAML extension already provides one), and approved the rest.

**Step three (implemented):**
- Inlay hints (`inlay-hint-provider.ts`): top-level timeline `at` as `m:ss.mmm`; children are left out because their `at` is relative. VS Code shows inlay hints by default.
- `unused-action` (hint, faded): actions not referenced by timeline items, children, diagram `action` or `[a:]`/`(a:)` placeholders (19 in the timelines).
- `last-child-link` (error), as in the build.
- `placeholder-description` (error) for actions and statuses with thaliak-cli's `Placeholder description` or its `castType: N, cast100ms: N, omenPath: X` description, skipped with wip `timeline` or `guide` (user's choice; the build uses `guide`).
- Strategy keys complete against graph IDs and graph IDs against strategy keys (each offers what the other side has that this side lacks); `unused-graph` (warning) for graphs no strategy names (2: top `p3-transition`, umad `p3-limit-cut`).
- Wording rules from the Author's Guide (information) on `description`, `resolve`, `trivia`, `caption`, `tips` and `mistakes`, with quick fixes where the replacement is unambiguous: damage adjectives (`light` → `mild`, `high` → `heavy`, ...; only directly before "damage" and not before "damage buff/up/down/..."), "do damage", "apply" before a status placeholder (no fix: inflict vs grant), "affected players" (no fix: also right for players hit by an attack), "party member", "KO". Known false positive: p11s's "light damage" means light-aspected damage.
- Fixed `isWip()`: it compared `Scalar` nodes with the kind string, so list-form `wip` never matched (m3s/m4s got `missing-auto-attacks` despite `wip: [.., damage, ..]`).

**Status:** Completed (awaiting user verification in VS Code).
