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

- Settings: `thaliak-timeline-linter.ironworksPath` (CLI executable; default: look it up on `PATH`) and `thaliak-timeline-linter.gameDirectory` (FFXIV install directory). The feature is off unless both work.
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
8. Whether thaliak's own `.cache` should be read as a fallback when present (only useful to the main author).

### Steps

1. Finish the exploration: read `thaliak/src/eleventy/utility/ironworks.ts` in full, the `ironworks-cli` README and argument parsing (`ironworks-cli/src`), and the call sites listed above. Resolve the unclear points, update this plan with the decisions, ask the user about whatever stays open, and get the completed plan approved before continuing.
2. Settings and CLI discovery (`package.json` `contributes.configuration`, client).
3. Cache and runner module: concurrency, and error handling (a missing CLI or a wrong game directory gives one warning, then the feature stays off without further messages).
4. In-game status icons in the tree (`client/src/outline-icons.ts`, `status` case).
5. Game names and descriptions in hovers and tree tooltips.
6. Verification, by the user: tree icons, hovers, behaviour without the CLI or setting, and the cost of the first run.
