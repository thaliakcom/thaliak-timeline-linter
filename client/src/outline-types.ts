// The result of the `thaliak/outline` request, which feeds the timeline tree view.
// Keep in sync with `server/src/types/outline.ts`.
import type { Location, Position, Range } from 'vscode-languageclient';

/** What a row's icon depicts. `outline-icons.ts` turns this into an actual icon. */
export type OutlineIcon =
    /** A status effect, by its game status ID, and its in-game icon (an absolute PNG path) if game data is on. */
    | { kind: 'status', statusId?: number, dot: boolean, path?: string }
    /** An action, by its mechanic shape (`undefined` for actions without a shape). */
    | { kind: 'shape', shape?: string }
    /** A `.diagram` element, by its key, its type and, for markers, its look. */
    | { kind: 'element', key: string, type?: string, look?: string }
    /** A section header, by its key (`status`, `actions`, `timeline`, `elements`). */
    | { kind: 'section', name: string }
    | { kind: 'phase' } | { kind: 'keyframe' };

/** A row of the timeline tree view. */
export interface OutlineNode {
    /** The key or a timestamp (`m:ss.mmm`). */
    label: string;
    /** The dimmed text after the label. */
    description?: string;
    /** The action or status the row shows (`a:<key>` or `s:<key>`), whose tooltip the client asks for with `thaliak/tooltip` on hover. */
    symbol?: string;
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

/** The parameters of the `thaliak/outline` and `thaliak/statusIcons` requests. */
export interface OutlineParams {
    uri: string;
}

/** The parameters of the `thaliak/tooltip` request, whose result is the Markdown tooltip of `symbol` (or `null`). */
export interface TooltipParams {
    uri: string;
    /** `a:<key>` or `s:<key>`. */
    symbol: string;
}

/**
 * An icon shown in front of a status key or reference, a mechanic `shape`, `ms:` reference or `place` action
 * (result of `thaliak/statusIcons`). It has either a `path` or an `svg`.
 */
export interface StatusIcon {
    range: Range;
    /** The absolute path of the PNG or SVG. */
    path?: string;
    /** Inline SVG markup, for the icons generated for one action (cones and donuts of their own size). */
    svg?: string;
}
