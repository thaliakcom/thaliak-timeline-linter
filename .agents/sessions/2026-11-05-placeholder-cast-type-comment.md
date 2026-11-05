# Placeholder cast type comment

**Task:** Explain the fallback `facts.castType = raw.shape === 'halfroom' ? 13 : 2;` in `server/src/diagram-context.ts`, which applies to actions with an `id` but no game data.

**Findings:**
- The value is a placeholder that only steers `drawnShape()` in `compile.ts`: it is read for `halfroom` (cone vs. line) and `in-or-out` (circle vs. donut), plus the shell check (`castType >= 2`). Other shapes are drawn from `shape` alone.
- The branch runs for every action with an `id` whenever game data is off (ironworks not configured or unavailable), not only in rare cases.
- Decision: keep 13 for halfroom rather than 12. With the placeholder size of 1 and `xAxisModifier` 1, 12 would draw a 1x1 square, 13 a half circle.

**Actions:** Added a comment above the line explaining the above. No code change.

**Status:** Completed.
