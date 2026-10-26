# Game data through ironworks-cli

## TL;DR

- Opt-in game data for the extension through the public `ironworks-cli`: a game directory setting, in-game status icons in the timeline tree, and the game's names and descriptions of actions and statuses in hovers and tree tooltips.
- Without the CLI or the setting, everything stays as it is (generic icons, no game text).
- This plan was written without further exploration, on purpose. Step 1 resolves the unclear points listed below and completes the plan; nothing is implemented before that.

## Details

### Context

The timeline tree view (`2026-10-26-timeline-tree-view.md`) shows generic status icons. In-game status icons were dropped from it because a status ID doesn't identify one icon (a status has one icon per stack count), and reading game data needs `ironworks-cli`, which the extension deliberately doesn't use yet. The same integration also enables showing game names and descriptions. The user prefers that users install the CLI themselves unless bundling it is easy.

### Known facts (from the thaliak site build)

- `thaliak/src/eleventy/utility/ironworks.ts` runs the CLI through `execIronworks(subcommand, id, saveToFile)`. Subcommands (enum `Subcommand`): `Action`, `Status`, `ContentFinderCondition`, `ClassJob`, `ClassJobCategory`, `BNpcBase`, `ModelSkeleton`, `role-action`, `job-action`, `icon`. Results are cached per subcommand as `thaliak/.cache/<dir>/<id>.<json|png>` (`actions`, `status`, `icons`, …). Concurrent calls for the same ID share one result.
- `Status` JSON has `name`, `description`, `icon` (icon ID), `maxStacks`, `statusCategory`, `hitEffect`, `transfiguration`, `isGaze`, `canDispel`, `inflictedByActor`, `isPermanent`. Example: status 628 → `"icon": 218441` → `.cache/icons/218441.png`.
- The site adds a stack offset to the base icon ID: `ironworks.getIcon(statusInfo.icon + iconOffset, …)` in `src/eleventy/data-extensions/yaml.ts`, with `getIconOffset` in `src/eleventy/utility/transform-value.ts`.
- Timeline status entries may override `name` and `icon`; overriding `icon` is discouraged (`thaliak/src/types/raids.ts`).
- Tree rows accept PNG icons (checked in the tree view spike).
- Tree icons are resolved on the client (`client/src/outline-icons.ts`, `status` case). Hovers come from the server (`server/src/hover-provider.ts`).

### Design (to be confirmed in step 1)

- Settings: `thaliak-timeline-linter.ironworksPath` (CLI executable; default: look it up on `PATH`) and `thaliak-timeline-linter.gameDirectory` (FFXIV install directory). The feature is off unless both work. Also `thaliak-timeline-linter.cachePath` (the dir that `ironworks-cli` saves its cached output in; should have the same shape as `thaliak/.cache` so that the user can reuse that path; if not defined it uses `context.globalStorageUri`, see below).
- Cache in the extension's global storage (`context.globalStorageUri`), with thaliak's `.cache` layout (`status/<id>.json`, `actions/<id>.json`, `icons/<id>.png`). The CLI only runs on cache misses, and concurrent requests for one ID share a call (as in `execIronworks`).
- Tree: status rows use the base icon (`Status.icon`, no stack offset). The lightning bolt and DoT icons stay as the fallback.
- Hovers and tree tooltips for actions and statuses show the game name and description after the timeline's own `description`; a timeline `name` override wins over the game name.

### Unclear points (resolve in step 1; don't guess)

1. The CLI's interface: how `execIronworks` builds the arguments (game directory flag, output to stdout or to a file, what saving to a file does for icons), and what the `icon` subcommand returns (a path or the PNG).
2. Bundling vs. user install: license, binary size, one build per platform (Windows, Linux/WSL, macOS).
3. The fields of `Action` JSON and which are worth showing (name, description, cast time?).
4. How `getIconOffset` derives the stack offset, and whether the tree should ever show a stacked icon.
5. Whether game descriptions contain markup that has to be converted to Markdown for hovers.
6. Run time and memory of one CLI call (decides whether to batch requests per file).
7. Where the CLI runs: client only (and the server asks the client for game text through a custom request), or both client and server (the server gets the settings and the cache path through `initializationOptions`). Depends on 1 and 6.

### Steps

1. Finish the exploration: read `thaliak/src/eleventy/utility/ironworks.ts` in full, the `ironworks-cli` README and argument parsing (`ironworks-cli/src`), and the call sites listed above. Resolve the unclear points, update this plan with the decisions, ask the user about whatever stays open, and get the completed plan approved before continuing.
2. Settings and CLI discovery (`package.json` `contributes.configuration`, client).
3. Cache and runner module: concurrency, and error handling (a missing CLI or a wrong game directory gives one warning, then the feature stays off without further messages).
4. In-game status icons in the tree (`client/src/outline-icons.ts`, `status` case).
5. Game names and descriptions in hovers and tree tooltips.
6. Verification, by the user: tree icons, hovers, behaviour without the CLI or setting, and the cost of the first run.

### Step 1 results and decisions (approved)

1. CLI interface: `ironworks-cli <Status|Action> <id> -g <dir>` prints one line of JSON; `icon <id>` writes PNG bytes to stdout; errors on stderr, exit 1. `ironworks-cli -v -g <dir>` prints `Final Fantasy XIV v<version>` if the game dir works (exit 0 either way), used as the probe. The CLI clones EXDSchema next to its own executable on the first run after each patch (needs internet).
2. Users install the CLI themselves: bundling needs per-platform builds, libgit2, and a writable directory next to the executable.
3. Fields shown. Actions: name, description (only job actions have one), cast time, `range`, `effectRange`, `attackType`, `omenPath`, `aspect`, `XAxisModifier`, `castType`; enum values as `<n> (<name>)`, names from the commented tables in `thaliak/src/eleventy/utility/data.ts`. Statuses: name, game description (a timeline `gameDescription` override wins), `maxStacks`, `canDispel`, `isPermanent`, `statusCategory`.
4. Stack offset: from a `:<n>` placeholder suffix (`icon + n - 1`). Tree rows show the base icon; inline icons in front of `s:` placeholders show the stacked one.
5. Descriptions are plain text with `\n` (checked over all of `thaliak/.cache`); converted to Markdown line breaks and escaped.
6. One call takes 0.1 to 0.25 s and about 20 MB (WSL, game on `/mnt/e`): no batching, at most `os.availableParallelism()` processes.
7. The CLI runs in the server only. The client passes the settings through `initializationOptions` and restarts the server when they change.

Cache: icons are kept forever; `status/` and `actions/` of the extension's own cache are cleared when the game version changes. A custom `cachePath` is never cleared. Inline status icons in the editor use decorations (added at the user's request).
