// The result of the `thaliak/outline` request, which feeds the timeline tree view.
// Keep in sync with `server/src/types/outline.ts`.
import type { Location, Position, Range } from 'vscode-languageclient';

/** What a row's icon depicts. `outline-icons.ts` turns this into an actual icon. */
export type OutlineIcon =
    /** A status effect, by its game status ID, which is resolved to the in-game icon. */
    | { kind: 'status', statusId?: number, dot: boolean }
    /** An action, by its mechanic shape (`undefined` for actions without a shape). */
    | { kind: 'shape', shape?: string }
    /** A graphing element, by its key, its type and, for markers, its look. */
    | { kind: 'element', key: string, type?: string, look?: string }
    /** A section header, by its key (`status`, `actions`, `timeline`, `graphing`, `elements`, `graphs`). */
    | { kind: 'section', name: string }
    | { kind: 'graph' } | { kind: 'phase' } | { kind: 'step' };

/** A row of the timeline tree view. */
export interface OutlineNode {
    /** The key, a timestamp (`m:ss.mmm`) or `step n`. */
    label: string;
    /** The dimmed text after the label. */
    description?: string;
    icon: OutlineIcon;
    /** The whole node, from its key through the end of its value. The row under the cursor is the deepest node containing it. */
    range: Range;
    /** Where clicking the row jumps to. */
    selection: Range;
    /** On definitions: the position to run Find All References from. */
    references?: Position;
    /** On usages: the definition Go to Definition jumps to. */
    definition?: Location;
    children?: OutlineNode[];
}

/** The parameters of the `thaliak/outline` request. */
export interface OutlineParams {
    uri: string;
}
