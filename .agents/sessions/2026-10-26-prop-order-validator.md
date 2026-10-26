# 2026-10-26: Prop order validator fixes

## Task

Fix the `inconsistent-prop-order` items of `todo`: full CPU on "fix all", the quick fix moving the
start of a graph step, the "last adjusted here" note pointing into later steps, no understanding of
sub element groups (`#[1, 2]`) and group keys (`players`, `tanks`), demanding "right after" instead
of "after" (`uwu.yaml:2641`), and only the first of several misplaced keys being marked.

## Actions

- Root causes in the old `validatePropertyOrder` (`server/src/linter-rules.ts`): each key stored
  only its neighbours (`after`/`before`); checks walked those chains, which loop forever once the
  chains form a cycle (they did after one "fix all" round on `uwu.yaml`). A violation compared
  against the stored neighbour's neighbour, hence the "right after" errors. The quick fix could
  move a key down, including the first key of a step (taking the `- ` with it).
- Rewrote it. `PropertyOrder` (`server.ts`) is a partial order: the relations "a before b" seen
  in one map (`relations`, with where they were first seen) and their transitive closure
  (`successors`). A map's relations are only added if they don't contradict earlier ones, so it
  never has cycles. Graph steps resolve keys to diagram elements with `resolveKey` and only the
  first step of a graph establishes the order (user's answer: elements missing from the first
  step are already an error elsewhere, and the hint must always point to the first step); an
  element set by several keys of one map belongs to the first. Other map kinds learn from every
  map.
- A first version used a flat list where unknown keys were inserted right after the key before
  them. That invented relations: `children` of `mistral-song-healer` (no `resolve`) ended up
  "before `resolve`", flagging `uwu.yaml:268` (user report). The partial order only holds
  relations actually seen; the notes list the chain of relations with where each was seen
  ("'a' comes before 'b' here").
- Design criterion from the user: a warning must always be resolvable. A key only conflicts with
  an earlier key whose names must all come after all of its own; keys sharing names never
  conflict, and since the order is acyclic, a topological sort clears every warning, so group
  keys like `[my-aoe, my-player]` can't get stuck.
- Every misplaced key is reported ("should come before 'Y'", Y = first earlier key entirely
  after it). Consecutive misplaced keys whose conflicts all lie before them (and not among each
  other) form one block: one multi-line diagnostic ("'a', 'b' and 'c' ... together, they should
  come before 'Y'") and one quick fix moving the whole block (user's request: the keys after the
  first are right relative to each other, only the block as a whole is misplaced). The quick fix
  only moves up, inserting after a step's `- `. Fix-all still applies one move per map per round
  (existing `uniqueness`).
- Verified: `npm run check-types` passes. Scratch probe in WSL `/tmp/proporder-probe` (runs
  `lintDocument` directly, emulates fix-all for 5 rounds) over all 9 timelines with graphs: no
  hangs (about 100-200 ms per lint), fixed files have the same content modulo key order and the
  same YAML error counts as the originals, step starts intact. `uwu.yaml:2641` no longer flagged.
  Not tested inside VS Code.
- Final warning counts (probe now loads the enums, so actions are checked too): `top.yaml` 503,
  `uwu.yaml` 177 (fix-all reaches 0 on `uwu.yaml` after 5 rounds). A lint of `top.yaml` takes
  about 600 ms, mostly `yaml` `toJS()` in other rules (`validateTimelineItems` converts the whole
  document once per `children` list), not the order code.
- `CHANGELOG.md` and `todo` left untouched.

## Status

Completed.
