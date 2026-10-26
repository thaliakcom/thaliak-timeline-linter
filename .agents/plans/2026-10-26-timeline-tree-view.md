# Timeline navigation: tree view and section lines

## TL;DR

- New **Thaliak** icon in the activity bar opens a tree of the active timeline file with four sections in file order: `status`, `actions`, `timeline` (grouped by `<phase>`), `graphing` (`elements`, `graphs` → steps).
- Rows show a dimmed secondary text (`raidwide (966)`, `impairment (628)`, `Phase 1: Beetle`, `m:ss.mmm` times), an icon, and hover buttons: **Find All References** on definitions, **Go to Definition** on usages. Clicking a row jumps to its line; the row under the cursor is highlighted while the tree is visible.
- Icons: in-game status icons from the thaliak build cache (`thaliak/.cache/icons/*.png`), else a generic status icon or a DoT icon; actions use small versions of the site's shape SVGs (new split icon for `in-or-out`, circle for `defamation`), else a generic icon; elements use the shape SVGs for AoE types, small static versions of the 13 deleted animated marker SVGs for markers (pin codicon for any marker without its own icon, e.g. ones added later), built-in codicons for the rest.
- The server builds the tree (it already parses the file) and sends it to the client through one custom request.
- Final step: full-width line and scrollbar mark before `status:`, `actions:`, `graphing:`, each graph and each `<phase>` item, from the same data.
- First step is a short spike that checks PNG icons in tree rows before the icon work is built on it.

## Details

### Context

Large timeline files (e.g. `ultimates/top.yaml`, 166 actions, 6 phases) are hard to navigate. Red Hat YAML's outline lists every property and knows nothing about phases, and it can't be replaced. A separate tree view in its own activity bar container avoids the conflict. Approved design decisions (from the user):

- Four sections in file order; `[3] Goto Parent Action` is dropped.
- Secondary text: actions `<mechanic> (<id>)`, statuses `<type> (<id>)`; times as fflogs-style `m:ss.mmm`, same as `formatTime` in `server/src/inlay-hint-provider.ts`.
- Own activity bar icon.
- Icons as listed in the TL;DR. Statuses: only two drawn icons (generic, DoT = diagonal poison bubbles) besides the in-game icons.
- Section lines are part of this plan, as the last step.

Before starting: copy this plan to `thaliak-timeline-linter/.agents/plans/2026-10-26-timeline-tree-view.md` (project rule: plans live in the project's `.agents/plans/`).

### Repository facts

- Linter: `\\wsl.localhost\Ubuntu-18.04\home\cengels\projects\thaliak-timeline-linter` (git via `wsl.exe -d Ubuntu-18.04 --cd <path> -- git …`; node via `wsl.exe -d Ubuntu-18.04 -- bash -lic "…"`, nvm node 23). Build: `npm run compile` (type-checks client and server, then esbuild bundles `client/src/extension.ts` and `server/src/server.ts` into `out/`).
- `client/tsconfig.json` and `server/tsconfig.json` each have `rootDir: src`, so the client can't import server files. Wire types are duplicated (see step 2).
- `.vscodeignore` excludes `client/**`, `server/**`; a new root `media/` folder is shipped.
- Server helpers to reuse (`server/src/util.ts`): `getIfType`, `getAtPathIfType`, `getEntry`, `getRange`, `getAction`, `getStatus`, `getStrategyKeys`. Child timestamp logic: `inlay-hint-provider.ts` (`addTimestamps`, `formatTime`). Move `formatTime` to `util.ts` and export it so both use it.
- Parser cache: `documentCache.get(textDocument)` returns `null` for files that aren't timelines (`isRaidData` in `parser-cache.ts`); use that to decide "not a timeline".
- Data layout (data repo `thaliak/_site/_data`):
  - `status: { <key>: { id: number, type: <status-type> } }`; status types in `enums/status-types.yaml` (`dot`, `vuln`, …).
  - `actions: { <key>: { id, mechanic?: <mechanic-type>, shape?: <shape>, children?: [{ at, id, … }] } }`. Child `at` is relative to the parent.
  - `timeline: [{ at, id, … }]`; phases are items with `id: <phase>`, `name`, `hp`. Other special ids: `SPECIAL_TIMELINE_IDS` in `util.ts`.
  - `graphing: { defs, elements: { <key>: { type?, look?, … } }, graphs: { <key>: [step maps] } }`. Element `type` is one of `donut`, `ellipse`, `cone`, `image`, `marker`, `rectangle`, `prism`, `link`, or absent (`server/src/types/graphing.ts`). `defs` is not shown.
- Shapes: `enums/mechanic-shapes.yaml`, 14 keys with `icon: /images/shapes/<file>.svg`: chariot→circle, dynamo→donut, cone→cone, `270°`→270, line, grid, plus, cross, sides, rect→rectangle, halfroom, star. `defamation` and `in-or-out` have no icon. Files: `thaliak/www/images/shapes/*.svg` (100×100 viewBox, glow filter `#edges`, e.g. cone fill `#95654e`).
- Marker looks (`MarkerLookType` in `thaliak/_site/_data/schemas/raid.schema.json`): `circle-kb`, `exaflare`, `flare`, `hello-world`, `line-stack`, `proximity`, `rotate-ccw`, `rotate-cw`, `spread-circle`, `stack`, `tankbuster`, `target-green`, `tower`. Their SVGs were deleted in thaliak commit `ff346075`; get them with `git show ff346075^:www/images/markers/<name>.svg`, and `git show ff346075^:www/images/other/hello-world.svg`. They animate with SMIL (`<animate>`, `<animateTransform>`).
- Status icon cache (thaliak build, ironworks-cli): `thaliak/.cache/status/<status id>.json` has `"icon": <icon id>`; `thaliak/.cache/icons/<icon id>.png` is the image (e.g. 628 → 218441). In this setup the enums are at `thaliak/_site/_data/enums`, so `.cache` is three levels up from the enums folder.

### Step 1: Spike — PNG icons in tree rows

Register a throwaway tree view with three rows using `iconPath: vscode.Uri.file('<…>/thaliak/.cache/icons/218441.png')`, one shape SVG and one codicon. Launch the Extension Development Host (ask the user for permission before launching; follow the `drive` skill) and check that the PNG shows and looks recognisable at row size. If PNGs don't render, stop and report to the user before continuing; the status icons then fall back to the two drawn icons only. Remove the spike code afterwards.

### Step 2: Wire format

`server/src/types/outline.ts` (and an identical copy `client/src/outline-types.ts`, with a comment on each to keep them in sync):

```ts
export type OutlineIcon =
    | { kind: 'status', statusId?: number, dot: boolean } // game status id; the client resolves it to an icon (step 5)
    | { kind: 'shape', shape?: string }                    // mechanic shape key; undefined = generic action
    | { kind: 'element', type?: string, look?: string }    // element type, marker look
    | { kind: 'graph' } | { kind: 'phase' } | { kind: 'section' } | { kind: 'step' };

export interface OutlineNode {
    label: string;              // key, time (`m:ss.mmm`) or `step n`
    description?: string;       // dimmed text
    icon: OutlineIcon;
    range: Range;               // whole node (key through end of value); the row under the cursor is the deepest node containing it
    selection: Range;           // where clicking jumps to (the key, or the `id:` value for timeline items)
    references?: Position;      // set on definitions: position to run Find All References from
    definition?: Location;      // set on usages: Go to Definition target
    children?: OutlineNode[];
}
```

Custom request `thaliak/outline`: params `{ uri: string }`, result `OutlineNode[] | null` (null = not a timeline). Register in `server/src/server.ts` with `connection.onRequest('thaliak/outline', outlineProvider(documents, documentCache, globalSettings))`, same factory pattern as the other providers.

### Step 3: Server — `server/src/outline-provider.ts`

Build top-level section nodes in document order (order of the top-level keys in `document.contents.items`), only for keys that exist:

- `status`: one node per status. Label key, description `<type> (<id>)` (omit missing parts; just `(<id>)` or `<type>` if one is missing), icon `{ kind: 'status', statusId: id, dot: type === 'dot' }`, `references` = start of the key.
- `actions`: one node per action. Description `<mechanic> (<id>)`, icon `{ kind: 'shape', shape }`, `references` = key start. Children: one node per `children` entry, label `+` + `formatTime(at)`, description `<child id>`, icon = the child action's shape icon (look it up in `actions`, then `enums.common`), `definition` = location of the child action's key (same lookup as `definition-provider.ts` `'a:'` branch: `getAction` on the document, then on `enums.common.document`).
- `timeline`: items before the first `<phase>` go directly under the section; each `<phase>` item becomes a node (label `formatTime(at)`, description `name`, icon phase) containing the following items until the next `<phase>`. Item node: label `formatTime(at)`, description `<id>`, icon = its action's shape icon, `definition` = its action's key (as above; none for special ids from `SPECIAL_TIMELINE_IDS`, which get a generic icon). For an item whose action has `children`, add one child node per child with label `formatTime(item.at + child.at)`, description child id, its own icon and `definition`. An `<endphase>` item ends the current phase group (it stays as the group's last row); the items after it go directly under the section until the next `<phase>`.
- `graphing`: node with two children, `elements` and `graphs` (only if present). Element node: label key, description = `look` value (string, or `look.type` if it's a map), icon `{ kind: 'element', type, look }`, `references` = key start. Graph node: label key, icon graph, `references` = key start, children `step 1…n` (label `step n`, icon step, range = the step map).

Ranges: use `getRange(textDocument, …)` from the yaml node ranges; `range` spans key start to value end. Verify while implementing that `references` positions actually return results from `reference-provider.ts` for each row kind (status key, action key, element key, graph key); if a kind returns nothing, still show the button but report the gap to the user rather than extending the reference provider.

### Step 4: Client — tree view (`client/src/outline-view.ts`)

`package.json` `contributes`:

```json
"viewsContainers": { "activitybar": [{ "id": "thaliak", "title": "Thaliak", "icon": "media/activity-bar.svg" }] },
"views": { "thaliak": [{ "id": "thaliak.outline", "name": "Timeline" }] },
"viewsWelcome": [{ "view": "thaliak.outline", "contents": "Open a Thaliak timeline file to see its outline." }],
"menus": { "view/item/context": [
    { "command": "thaliak-timeline-linter.outline.findReferences", "when": "view == thaliak.outline && viewItem =~ /references/", "group": "inline" },
    { "command": "thaliak-timeline-linter.outline.goToDefinition", "when": "view == thaliak.outline && viewItem =~ /definition/", "group": "inline" }
] }
```

plus the two commands with icons `$(references)` and `$(go-to-file)` and titles "Find All References" / "Go to Definition". Hide them from the command palette (`menus.commandPalette` with `when: false`). `media/activity-bar.svg`: a simple monochrome 24×24 icon (e.g. three horizontal bars of different lengths on a vertical axis, suggesting a timeline), `fill="currentColor"`.

`TreeDataProvider<OutlineNode>`:
- Data: on active editor change and on document change of the active document (debounced 300 ms), send `client.sendRequest('thaliak/outline', { uri })`, store the result, fire `onDidChangeTreeData`. `null` → empty tree (welcome text shows).
- `getTreeItem`: label, description, `collapsibleState` (sections and phases expanded, everything else collapsed; keep VS Code's own state across refreshes by giving each item a stable `id` = path of labels/keys from the root), `contextValue` = space-separated `references`/`definition`, `command` = reveal `selection` in the editor (`vscode.window.showTextDocument(uri, { selection })`), tooltip = description.
- `getParent`: keep a parent map built on refresh (needed for `reveal`).
- Cursor sync: on `onDidChangeTextEditorSelection` for the active document, when `treeView.visible`, find the deepest node whose `range` contains the cursor and call `treeView.reveal(node, { select: true, focus: false, expand: false })`. Debounce 100 ms.
- Commands: `findReferences(node)` → `vscode.commands.executeCommand('editor.action.findReferences', uri, node.references)`; `goToDefinition(node)` → `showTextDocument(node.definition.uri, { selection: node.definition.range })`. Convert the LSP ranges with `client.protocol2CodeConverter`.
- Wire it in `extension.ts` `activate` after `client.start()`; push disposables to `context.subscriptions`.

### Step 5: Icons

`client/src/outline-icons.ts`, mapping `OutlineIcon` to `TreeItem.iconPath`:
- `status`: if the cache is found and `.cache/status/<statusId>.json` has `icon` and `.cache/icons/<icon>.png` exists → `Uri.file(png)`. Else `media/status/dot.svg` if `dot`, else `media/status/generic.svg`. Cache discovery: on activation, take the first `**/enums/*.yaml` URI already found in `extension.ts`, walk up parent directories (max 5) until one contains `.cache/icons`; remember it (or `null`). Read the JSON files lazily and memoise per status id.
- `shape`: `media/shapes/<file>.svg` for the 12 shapes with icons, `circle.svg` for `defamation`, `media/shapes/in-or-out.svg` for `in-or-out`; unknown/absent → codicon `symbol-event`.
- `element`: `donut`→donut, `ellipse`→circle, `cone`→cone, `rectangle`→rectangle shape SVGs; `marker` → `media/markers/<look>.svg` if that file exists, otherwise codicon `pin`. The fallback is required: markers added to the schema later (or a missing/unknown `look`) must show the pin, never an empty icon; `image`→`file-media`, `link`→`link`, `prism`→`symbol-constant`, no type→`person`. (Codicon names: check each exists in the codicon set shipped with VS Code during the spike; replace with a close match if one doesn't.)
- `graph`→`graph`, `phase`→`milestone`, `step`→`debug-stackframe-dot`, `section`→`symbol-namespace` (same check).

SVG assets (all in `media/`, viewBox `0 0 16 16` or the original viewBox, no filters, no animation):
- `media/shapes/*.svg`: copies of `thaliak/www/images/shapes/*.svg` for the 12 referenced files, with the `#edges` glow filter removed (solid fill) and outlines thickened where thin lines would disappear at 16 px.
- `media/shapes/in-or-out.svg`: new. Diagonal split from bottom-left to top-right: the circle (chariot) in the top-left half, the donut in the bottom-right half, divided by a thin line along the diagonal. Use `clipPath`s with the two triangles; same colours as the circle/donut icons.
- `media/markers/<look>.svg`: the 13 SVGs from git history, made static: remove every `<animate>`/`<animateTransform>`/`<animateMotion>` and set the animated attribute to its value at a chosen time. Pick the time per file so that most parts are visible (not mid-fade, not scaled to 0, opacity not near 0); prefer a time where the parts are at full opacity. Then simplify for 16 px like the shapes.
- `media/status/generic.svg` (simple status-effect frame, e.g. a rounded square with an up arrow) and `media/status/dot.svg` (diagonal poison bubbles: three circles of increasing size from bottom-left to top-right, green).

Render every SVG to a PNG at 16 px and 32 px (e.g. with the Windows Chrome headless or any available rasteriser) and look at the result before using it; show the user a contact sheet of all icons for sign-off.

### Step 6: Section lines

Client-side, from the same `thaliak/outline` result (no extra request): collect the `selection.start.line` of the `status`, `actions` and `graphing` section nodes, each graph node and each phase node. One `TextEditorDecorationType`:

```ts
vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: '1px 0 0 0',
    borderStyle: 'solid',
    borderColor: '#59a2e366',
    overviewRulerColor: '#59a2e3',
    overviewRulerLane: vscode.OverviewRulerLane.Full
});
```

(`#59a2e3` is the extension's brand colour from `galleryBanner`.) Apply to the active editor whenever the outline data refreshes; clear it when the outline is `null`. Sections use the top-level key line; phases use the line of the `- at:` of the phase item (the item's start).

### Verification

1. `npm run compile` passes (type checks client and server).
2. Server unit check without VS Code: a scratch script (pattern: bundle with the project's esbuild in WSL, as in `/tmp/ttl-repro/run.sh`) calling `outlineProvider` on `ultimates/top.yaml` and `raids/m2s.yaml`; check the section order, phase grouping (top.yaml: 6 phases), child times (`item.at + child.at`), and that every `definition`/`references` position is non-null where expected. Also run it on a CRLF file (`ultimates/uwu.yaml`).
3. Extension Development Host (with user permission, `drive` skill), opened on the thaliak workspace: open `top.yaml` and check
   - the tree shows the four sections, phases with names, times in `m:ss.mmm`;
   - clicking rows jumps to the right line; moving the cursor highlights the matching row;
   - Find All References and Go to Definition buttons work for each row kind;
   - status rows show in-game icons; a status without a cached icon shows the generic/DoT icon;
   - editing the file refreshes the tree without collapsing expanded nodes;
   - section lines and scrollbar marks appear at `status:`, `actions:`, `graphing:`, each graph and each phase;
   - switching to a non-timeline YAML file empties the tree and removes the lines.
4. Write the session file in the linter's `.agents/sessions/`. Leave `CHANGELOG.md` and the version alone (the user bumps them).
