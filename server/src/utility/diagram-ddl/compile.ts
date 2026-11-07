// Turns a parsed `.diagram` file and the fight's actions into plain JSON that `seek.ts` can read,
// and reports everything that makes the file invalid. Runs at build time only.
import * as yaml from 'js-yaml';
import { RESOLVE_PRESETS } from '../../components/diagram/render/effects/presets';
import { planeUnitsPerYalm } from '../diagram-sizing';
import { BOSS_IMAGE, DEFAULT_ACTOR_GRAPHICS } from '../diagram-defaults';
import { DDL_MARKER_LOOKS } from '../diagram-enums';
import { expandMargin } from '../margin';
import { Definition, Diagnostic, parse, Statement } from './parse';
import { callPlaceholder, PLAYER_GROUPS, resolveWaymarks } from './placeholders';
import type { Margin } from '../../types/graphing';
import { AoeArea, AoePart, ArenaChange, CompiledAoe, CompiledDiagram, CompiledElement, definitionKey, GhostTrack, MOTION_RAMP, Pose, positionAt, rotationAt, Scope, Spawn, XY } from './seek';

/** Run speed in yalms per ms. */
const RUN_SPEED = 6 / 1000;
/** Plane units per yalm where a fight's arena can't say, which is only without an arena image or arena size. */
const DEFAULT_UNITS_PER_YALM: XY = [5, 5];
/** The size of the arena's box unless its definition says otherwise, as in `DEFAULT_GRAPHICS.arena`. */
const DEFAULT_ARENA_BOX = 200;
const MIN_KEYFRAME_GAP = 1000;
/** How fast an actor chases what it follows, in yalms per second, unless it says otherwise. Provisional, until tested against logs. */
const DEFAULT_FOLLOW_SPEED = 6;
/** How close an actor comes to what it follows, in yalms from its hitbox's edge to the player icon's, unless it says otherwise. */
const DEFAULT_REACH = 1;
/** How long a hint must show at least, in ms, so that it can be read. */
const MIN_HINT_DURATION = 3000;
/** The radius of a player icon in yalms: `PLAYER_SIZE` at `ICON_REFERENCE_SCALE`, where icons have their defined size. */
const PLAYER_ICON_RADIUS = 7.5 / 2 / 4.39;
/** How often a follow is played out, in ms. */
const FOLLOW_STEP = 50;
/**
 * How fast a follower turns toward what it follows, in degrees per ms, so that it turns rather than snaps where its
 * target got far from its front, as after a cast lock. Provisional, until tested against footage.
 */
const FOLLOW_TURN_SPEED = 360 / 1000;
/** A fixed-size list of numbers in round brackets, `(0.5, 0)`, not right after a name, so that `rgba(0, 0, 0, 1)` stays as it is. */
const ROUND_TUPLE = /(?<![\w-])\(\s*(-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)+)\s*\)/g;
/** The same in square brackets, which are only for placeholders. */
const SQUARE_TUPLE = /(?<![\w-])\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)+\s*\]/;

/** The game action IDs that a `.diagram` file's `+aoe` statements draw instead with `as`, whose facts {@link DiagramInput.variants} needs. */
export function variantIdsOf(source: string): number[] {
    return [...new Set([...source.matchAll(/^.*\+aoe\b.*$/gm)].flatMap(line => [...line[0].replace(/\/\/.*$/, '').matchAll(/\bas\s+(\d+)\b/g)].map(match => Number(match[1]))))];
}

/**
 * Where an element's front points when it's drawn unrotated, in degrees clockwise from north, as the old renderer's
 * `facing()` has it: a cone opens north, and anything else points from its origin through its centre. A centred
 * element faces north, which images are drawn to match.
 */
function facingOf(definition: Record<string, unknown>): number {
    if (definition.type === 'cone') return 0;

    const size = definition.size as number | number[] | undefined;
    const [width, height] = typeof size === 'number' ? [size, size] : Array.isArray(size) ? [size[0] ?? 1, size[1] ?? 1] : [1, 1];
    const origin = (definition.origin ?? 0.5) as number | number[];
    const [x, y] = typeof origin === 'number' ? [origin, origin] : [origin[0] ?? 0.5, origin[1] ?? 0.5];
    let dx = (0.5 - x) * width;
    let dy = (0.5 - y) * height;

    // A zero size in one direction; the origin alone decides.
    if (dx === 0 && dy === 0) [dx, dy] = [0.5 - x, 0.5 - y];

    return dx === 0 && dy === 0 ? 0 : Math.atan2(dx, -dy) * 180 / Math.PI;
}

/**
 * Reads the value of a `define` field, which is YAML flow except that fixed-size values are written like
 * coordinates, `origin: (0.5, 0)`. Throws on the square form, since square brackets only insert elements.
 */
function readFieldValue(text: string): unknown {
    if (SQUARE_TUPLE.test(text)) throw new Error('fixed-size values take round brackets, as in (0.5, 0)');

    return yaml.load(text.replace(ROUND_TUPLE, '[$1]'));
}
/** The definition of ghosts: slightly transparent and desaturated. */
const GHOST_BASE = 'ghost';
const GHOST_SIZE = 7.5;
/**
 * Whether enemies get ghosts. Off for now (the author's decision, 2026-11-04): they don't work yet, and a log's
 * unknown enemies show up as tiny ghosts that never move. Players keep theirs.
 */
const SHOW_ENEMY_GHOSTS = false;
const RAIDWIDE_BASE = 'diagram-raidwide';
/** The element that shows an action's name as it hits. */
const LABEL_BASE = 'diagram-label';
/** Large enough for a sweep from the arena's edge to reach the far edge. */
const RAIDWIDE_SIZE = 420;
const DASHED = { look: { type: 'none' }, stroke: { style: 'dashed', color: '#fce76e' } };
/** Definition keys that describe a placement rather than the drawn element. */
const NON_VISUAL_KEYS = new Set(['attached', 'hooks', 'tracks', 'headmarker']);
/** The `define action` keys that were removed: an action's hit shows only its resolve effect. */
const REMOVED_KEYS = ['flash', 'flashLook', 'hold', 'hidden'];
/** The element kinds that `define` declares, by the verb that places them. */
const KIND_OF_VERB: Record<string, Definition['kind']> = { actor: 'actor', object: 'object', puddle: 'puddle', tether: 'tether' };
/** The element types each kind can have, as written; `type: graphic` is the viewer's `marker`. A kind with one type implies it. */
export const TYPES_OF_KIND: Partial<Record<Definition['kind'], readonly string[]>> = {
    arena: ['image'],
    tether: ['link'],
    actor: ['image', 'graphic'],
    object: ['ellipse', 'rectangle', 'cone', 'donut', 'prism', 'image', 'graphic'],
    puddle: ['ellipse', 'rectangle', 'cone', 'donut', 'image', 'graphic']
};
/** A headmarker's size in plane units, which isn't the diagram's to choose. */
const HEADMARKER_SIZE = 20;
const HEADMARKER_SIZES: Partial<Record<string, number>> = { 'rotate-cw': 40, 'rotate-ccw': 40 };
/** The element that draws an AoE whose omen look is a built-in drawing (`tower`, `exaflare`, `circle-kb`) over its circle. */
const AOE_GRAPHIC_BASE = 'aoe-graphic';
/** The `define action` keys that are now facts of the timeline action, and where each one went. */
const MOVED_KEYS: Record<string, string> = {
    telegraph: 'the element comes from the timeline action\'s "shape"',
    type: 'the element comes from the timeline action\'s "shape"',
    angle: 'set "angle" on the timeline action',
    size: 'the size comes from game data, and from "angle", "inner", "grid" and "spacing" on the timeline action',
    use: 'use "attached: true", which attaches the AoE to the timeline action\'s "actor"'
};
/** How every AoE element looks, unless its action's definition or its omen says otherwise. */
const AOE_LOOK = { opacity: 0.85, shadow: false, enter: 'scale' };
/** The built-in elements that draw AoEs, by the element type they draw. */
const AOE_BASES = { ellipse: 'aoe-ellipse', cone: 'aoe-cone', donut: 'aoe-donut', rectangle: 'aoe-rectangle' } as const;
/** The built-in element that draws each rectangle of a composite AoE, centred on its spot. */
const AOE_PART_BASE = 'aoe-part';
const AOE_DEFINITIONS: Record<string, Record<string, unknown>> = {
    [AOE_BASES.ellipse]: { type: 'ellipse', ...AOE_LOOK },
    [AOE_BASES.cone]: { type: 'cone', ...AOE_LOOK },
    [AOE_BASES.donut]: { type: 'donut', ...AOE_LOOK },
    // A line starts at its caster and runs forward.
    [AOE_BASES.rectangle]: { type: 'rectangle', origin: [0.5, 1], ...AOE_LOOK },
    [AOE_PART_BASE]: { type: 'rectangle', ...AOE_LOOK },
    [AOE_GRAPHIC_BASE]: { type: 'marker', ...AOE_LOOK }
};
/** How much of a line's half-width fades out at its sides when game data has no width for it. */
const UNKNOWN_WIDTH_FADE = 0.8;
/** The cast types that draw a circle, a donut, a cone and a line, for `in-or-out` and `halfroom`. */
const CIRCLE_CAST_TYPES = [2, 5, 7];
const DONUT_CAST_TYPE = 10;
const CONE_CAST_TYPES = [3, 13];
const LINE_CAST_TYPES = [4, 8, 12];
/** Effect names without a preset of their own yet. */
const EFFECT_ALIASES: Record<string, string> = { laser: 'wave-cannon' };
/** Why an actor can't name its BNpcBase with `bnpc` any more. */
const BNPC_INSTEAD = 'name the actor by its key in the timeline\'s "actors", whose "id" gives its hitbox';
/** How far out the ring of {@link BOSS_IMAGE} runs, as a fraction of the icon's half-width: its centre line, at 55.5 of 62. */
const BOSS_RING = 55.5 / 62;
const PLAYERS: string[] = PLAYER_GROUPS['players']!;
const GROUPS: Record<string, string[]> = Object.fromEntries(Object.entries(PLAYER_GROUPS).map(([group, players]) => [`<${group}>`, players]));

/** The facts about an action that a diagram needs. */
export interface ActionFacts {
    /** The game action ID. */
    id?: number;
    name?: string;
    /** Who casts it: a key of {@link DiagramInput.actors}, or several. */
    actor?: string | string[];
    /** The game action ID of its hit, if that isn't the cast itself. A child with that ID makes this action only group its children. */
    hit?: number;
    shape?: string;
    mechanic?: string;
    count?: number;
    /** The damage of one hit. An action with children, none of its own and no AoE in game data only groups them. */
    damage?: number;
    /** The targeting in game data: 1 is a single target, and anything above is an AoE. */
    castType?: number;
    /** The cast in ms. */
    cast?: number;
    /** How long the caster's attack animation keeps it in place after the cast, in ms. */
    animationLock?: number;
    /** The radius or length in yalms. */
    effectRange?: number;
    /** The width in yalms of a rectangular AoE. */
    xAxisModifier?: number;
    /** A cone's full angle in degrees, from the timeline. */
    angle?: number;
    /** A donut's inner radius in yalms, from the timeline. */
    inner?: number;
    /** A `grid`'s number of lines along each axis, from the timeline. */
    grid?: [number, number];
    /** The gap in yalms between a `grid`'s lines, from the timeline. */
    spacing?: number;
    hasOmen?: boolean;
    /** The path of the telegraph in game data, which {@link DiagramInput.omens} gives a look. */
    omen?: string;
    'omen-delay'?: number;
    timing?: string;
    emphasis?: string;
    children?: RawItem[];
    strategies?: Record<string, unknown>;
}

/** A timeline item or action child as written in the timeline file. */
export interface RawItem {
    at: number;
    id: string;
    count?: number;
    timing?: string;
    flatten?: boolean | string;
    strategies?: Record<string, unknown>;
    image?: string;
    margins?: Margin;
    /** Who a `<targetable>` or `<untargetable>` item is about, such as `Omega-M and F`. Without one, everyone. */
    target?: string;
}

/** A `<targetable>` or `<untargetable>` item of a timeline, with an absolute time. */
export interface TargetabilityChange {
    at: number;
    targetable: boolean;
    target?: string;
}

/** One use of an action on the timeline. */
export interface Use {
    action: string;
    at: number;
    count?: number;
    /** The action this use is a child of. */
    parent?: string;
    /** When its last child hits, if it has children. */
    lastChild?: number;
    /** The strategies on the timeline item itself. */
    strategies?: string[];
}

/** A `.ghosts` file, as `thaliak-cli diagram` writes it. Samples are in yalms from the arena's center. */
export interface GhostFile {
    players: Record<string, { job?: string, samples: [number, number, number][] }>;
    bosses: Record<string, { samples: [number, number, number][] }>;
}

export interface DiagramInput {
    ghosts?: GhostFile;
    uses: Use[];
    actions: Record<string, ActionFacts>;
    arenas: ArenaChange[];
    /** The fight's arena size in yalms. */
    arenaSize?: [number, number];
    waymarks?: Record<string, Record<string, unknown>>;
    /** When the timeline says that bosses can't be targeted, which is when {@link ghosts} don't draw them. */
    targetability?: TargetabilityChange[];
    /**
     * The timeline's actors, by key. An `+actor`'s ID before its `#` is one of these keys. An actor with an `id` (a BNpcBase)
     * shows the cast bars of its actions and holds still while it casts; one without, the helper, does neither. An
     * actor's `name` labels it while it's drawn with the boss icon and another such actor is alive.
     */
    actors?: Record<string, { id?: number, name?: string }>;
    /** Hitbox radii in yalms, by actor key, for actors with an `id`. */
    hitboxes?: Record<string, number>;
    /** AoE looks by the omen of their action, from `enums/omens.yaml`. An AoE whose omen isn't listed looks like `aoe`. */
    omens?: Record<string, unknown>;
    /**
     * Headmarker looks by game icon, from `enums/headmarkers.yaml`. Its looks, and `unknown`, are the headmarkers a
     * diagram can use; without it, every headmarker look is.
     */
    headmarkers?: Record<string, string>;
    /** Tether looks by game file, from `enums/tethers.yaml`. Its looks, and `unknown`, are tethers without a definition. */
    tethers?: Record<string, string>;
    /** Game data of the actions that `+aoe ... as <game action ID>` draws instead, by those IDs (see {@link variantIdsOf}). */
    variants?: Record<number, ActionFacts>;
}

/** What draws an AoE: one element of a type and size in yalms, or several rectangles (sizes and offsets in yalms). */
export type DrawnShape =
    | { type: keyof typeof AOE_BASES, yalms: [number, number], angle?: number, fade?: number }
    | { type: 'parts', parts: { offset: XY, rotate: number, size: XY }[] };

/**
 * What an action's AoE is drawn as, from its timeline `shape` and its facts; see the table in
 * `.agents/plans/2026-11-04-shapes.md` (thaliak-suite). `arena` is the arena's larger side in yalms, which
 * lines that span or cut the arena reach across. Returns why it can't be drawn instead, naming what's missing.
 */
export function drawnShape(facts: ActionFacts, arena: number | undefined): DrawnShape | string {
    const range = facts.effectRange ?? 0;
    const width = facts.xAxisModifier ?? 0;
    const castType = facts.castType ?? 0;
    const across = arena ?? range * 2;
    const noRange = 'has no effectRange in game data';
    const ellipse = (): DrawnShape | string => range > 0 ? { type: 'ellipse', yalms: [range * 2, range * 2] } : noRange;
    const donut = (): DrawnShape | string => range <= 0 ? noRange
        : facts.inner == null ? 'needs an "inner" radius on its timeline action'
        : { type: 'donut', yalms: [facts.inner * 2, range * 2] };
    const cone = (angle: number | undefined): DrawnShape | string => range <= 0 ? noRange
        : angle == null ? 'needs an "angle" on its timeline action'
        : { type: 'cone', yalms: [0, range], angle };
    // Without a width in game data, the line may be of any width, so it's drawn wide and fades out at its sides.
    const line = (): DrawnShape | string => range <= 0 ? noRange
        : width > 0 ? { type: 'rectangle', yalms: [width, range] }
        : { type: 'rectangle', yalms: [across, range], fade: UNKNOWN_WIDTH_FADE };
    const cross = (angles: number[]): DrawnShape | string => range <= 0 || width <= 0 ? 'needs an effectRange and an XAxisModifier in game data'
        : { type: 'parts', parts: angles.map(rotate => ({ offset: [0, 0], rotate, size: [width, range * 2] })) };

    switch (facts.shape) {
        case 'chariot':
        case 'defamation':
            return ellipse();
        case 'dynamo':
            return donut();
        case 'cone':
            return cone(facts.angle);
        case 'line':
        case 'rect':
            return line();
        case 'halfroom':
            return CONE_CAST_TYPES.includes(castType) ? cone(facts.angle ?? 180)
                : LINE_CAST_TYPES.includes(castType) ? line()
                : `is a halfroom of castType ${castType}, which is neither a cone nor a line`;
        case 'in-or-out':
            return CIRCLE_CAST_TYPES.includes(castType) ? ellipse()
                : castType === DONUT_CAST_TYPE ? donut()
                : `is in-or-out of castType ${castType}, which is neither a circle nor a donut: draw it with "as <game action ID>"`;
        case 'plus':
            return cross([0, 90]);
        case 'cross':
            return cross([45, 135]);
        case 'star':
            return cross([0, 45, 90, 135]);
        case 'sides': {
            // The safe lane through the caster is as wide as the XAxisModifier; each side reaches from it to the arena's edge.
            const side = across / 2 - width / 2;

            if (range <= 0) return noRange;
            if (side <= 0) return `has a safe lane of ${width} yalms, as wide as the arena`;

            return { type: 'parts', parts: [-1, 1].map(sign => ({ offset: [sign * (width + side) / 2, 0] as XY, rotate: 0, size: [side, range] as XY })) };
        }
        case 'grid': {
            if (facts.grid == null) return 'needs "grid" on its timeline action';
            if (width <= 0) return 'needs an XAxisModifier in game data, for the width of its lines';

            // Centred as a group on the AoE's position.
            const step = width + (facts.spacing ?? width);
            const lines = (count: number, rotate: number) => Array.from({ length: count }, (_, i) => {
                const at = (i - (count - 1) / 2) * step;
                return { offset: (rotate === 0 ? [at, 0] : [0, at]) as XY, rotate, size: [width, across] as XY };
            });

            return { type: 'parts', parts: [...lines(facts.grid[0], 0), ...lines(facts.grid[1], 90)] };
        }
        default:
            return facts.shape == null ? 'has no "shape" on its timeline action' : `has the shape "${facts.shape}", which draws nothing`;
    }
}

const toXY = ([d, a]: number[]): XY => [d! * Math.sin(a! * Math.PI / 180), -d! * Math.cos(a! * Math.PI / 180)];
/** Where an ID's own name ends: at the `#` before a sub-ID, or at the `@` before a tether's ends. */
const nameEnd = (id: string) => {
    const end = id.search(/[#@]/);
    return end < 0 ? id.length : end;
};
const subIdOf = (id: string) => nameEnd(id) === id.length ? id : id.slice(nameEnd(id) + 1);
const baseOf = (id: string) => id.slice(0, nameEnd(id));
const duration = (value: string) => value.endsWith('ms') ? parseFloat(value) : value.endsWith('s') ? parseFloat(value) * 1000 : Number(value);
/** The actor keys of an action, which `actor` names as one key or a list. */
const actorsOf = (action: ActionFacts | undefined): string[] => action?.actor == null ? [] : Array.isArray(action.actor) ? action.actor : [action.actor];
const isRaidwide = (action: ActionFacts | undefined) => action?.mechanic?.startsWith('raidwide') === true || action?.mechanic === 'enrage';

/**
 * Lists every use of the items, recursively, with absolute times. It must get the items as written: processing a
 * timeline splices nested children into their parents. `<...>` pseudo-items and `timing: skippable` failures are left out.
 */
export function usesOf(items: RawItem[], actions: Record<string, ActionFacts>, base: number = 0, parent?: string): Use[] {
    return items.flatMap(item => {
        const action = actions[item.id];

        if (item.id.startsWith('<') || (item.timing ?? action?.timing) === 'skippable') return [];

        const at = base + item.at;
        const nested = item.flatten === 'omit-children' ? [] : usesOf(action?.children ?? [], actions, at, item.id);
        const use: Use = { action: item.id, at };

        if (item.count != null) use.count = item.count;
        if (parent != null) use.parent = parent;
        if (nested.length > 0) use.lastChild = Math.max(...nested.map(child => child.lastChild ?? child.at));
        if (item.strategies != null) use.strategies = Object.keys(item.strategies);

        return [use, ...nested];
    });
}

/** Lists the `<targetable>` and `<untargetable>` items, recursively, in time order. Like {@link usesOf}, it must get the items as written. */
export function targetabilityOf(items: RawItem[], actions: Record<string, ActionFacts>, base: number = 0): TargetabilityChange[] {
    return items.flatMap((item): TargetabilityChange[] => {
        const action = actions[item.id];
        const at = base + item.at;

        if (item.id === '<targetable>' || item.id === '<untargetable>') {
            return [{ at, targetable: item.id === '<targetable>', ...(item.target != null ? { target: item.target } : {}) }];
        }

        if (item.id.startsWith('<') || (item.timing ?? action?.timing) === 'skippable' || item.flatten === 'omit-children') return [];

        return targetabilityOf(action?.children ?? [], actions, at);
    }).sort((a, b) => a.at - b.at);
}

/**
 * Whether a change's target names the boss, however it's written: `Omega-M and F` names `Omega-M`, and `Alpha-Omega`
 * names the log's `Alpha Omega`. Bosses that a timeline calls something else entirely aren't matched, and stay drawn.
 */
function namesBoss(target: string | undefined, boss: string): boolean {
    const normalize = (name: string) => name.trim().toLowerCase().replaceAll(' ', '-');

    return target == null || target.split(/\s+and\s+|,/).some(name => normalize(name) === normalize(boss));
}

/** When `boss` is untargetable, as `[from, to)` ranges. One that the timeline never ends lasts until the end of the track. */
function hiddenRanges(boss: string, changes: readonly TargetabilityChange[]): [number, number][] {
    const ranges: [number, number][] = [];
    let from: number | null = null;

    for (const { at, targetable, target } of changes) {
        if (!namesBoss(target, boss)) continue;

        if (!targetable && from == null) {
            from = at;
        } else if (targetable && from != null) {
            ranges.push([from, at]);
            from = null;
        }
    }

    if (from != null) ranges.push([from, Number.MAX_SAFE_INTEGER]);

    return ranges;
}

/** Lists the `<arena>` items of a timeline, in time order. */
export function arenasOf(items: RawItem[]): ArenaChange[] {
    return items.flatMap(item => item.id === '<arena>' && item.image != null
        ? [{ at: item.at, image: item.image, ...(item.margins != null ? { margin: item.margins } : {}) }]
        : []).sort((a, b) => a.at - b.at);
}

/** Expands `[a, b]`, `[1..3]`, `[*]` and `<group>` into every combination, in order. A `*` stays in the result. */
export function expandTemplate(token: string): string[] {
    if (GROUPS[token] != null) return GROUPS[token]!;

    const open = token.indexOf('[');

    if (open < 0) return [token];

    const close = token.indexOf(']', open);
    const inner = token.slice(open + 1, close);
    const range = /^(\d+)\.\.(\d+)$/.exec(inner.trim());
    const options = range != null
        ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => String(Number(range[1]) + i))
        : inner.split(',').flatMap(s => GROUPS[s.trim()] ?? [s.trim()]);

    return options.flatMap(option => expandTemplate(token.slice(0, open) + option + token.slice(close + 1)));
}

/** Parses `(a, b)` into numbers, a bare number into a number, and leaves anything else as a string. */
function literal(value: string): number | string | number[] {
    if (/^\(.*\)$/.test(value)) return value.slice(1, -1).split(',').map(Number);
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if (/^".*"$/.test(value)) return value.slice(1, -1);
    return value;
}

/** Returns whether two scopes can both apply under one selection. */
function compatible(a: Scope, b: Scope): boolean {
    if (a.strategy != null && b.strategy != null && a.strategy !== b.strategy) return false;
    if (a.branch != null && b.branch != null && a.branch[0] === b.branch[0] && a.branch[1] !== b.branch[1]) return false;
    return true;
}

/**
 * Labels every element drawn with the boss icon (`actorOf` gives its timeline actor) with that actor's `name` while
 * another boss-icon element is alive in a compatible scope, including copies of the same actor. Elements that `as`
 * labels, and actors without a name, keep what they have. The labels are `text` sets at each spawn and each change.
 */
function addNameLabels(elements: CompiledElement[], actorOf: (base: string) => { name?: string } | undefined) {
    const bosses = elements.filter(element => actorOf(element.base) != null);

    for (const element of bosses) {
        const name = actorOf(element.base)?.name;

        if (name == null || element.props.text != null) continue;

        for (const { from, to, ...scope } of element.spawns) {
            const others = bosses.flatMap(other => other === element ? [] : other.spawns.filter(spawn => compatible(spawn, scope) && spawn.from < to && spawn.to > from));
            const times = [...new Set([from, ...others.flatMap(spawn => [spawn.from, spawn.to])])].filter(t => t >= from && t < to).sort((a, b) => a - b);
            let shown: boolean | undefined;

            for (const t of times) {
                const crowded = others.some(spawn => t >= spawn.from && t < spawn.to);

                if (crowded !== shown) element.sets.push({ ...scope, t, over: 0, key: 'text', value: crowded ? name : '' });

                shown = crowded;
            }
        }

        // `propAt` lets the last matching set win, so they must be in time order across spawns.
        element.sets.sort((a, b) => a.t - b.t);
    }
}

/** Identifies a scope, for grouping items by it. */
function scopeKey(scope: Scope): string {
    return `${scope.strategy ?? ''}|${scope.branch?.join(':') ?? ''}`;
}

/** Only the scope's set keys, so that unscoped items stay small in the JSON. */
function scopeOf(scope: Scope): Scope {
    return { ...(scope.strategy != null ? { strategy: scope.strategy } : {}), ...(scope.branch != null ? { branch: scope.branch } : {}) };
}

/** An action's `headmarker: <look> at -<lead> [for <duration>]`, in ms. */
interface HeadmarkerField {
    look: string;
    lead: number;
    /** How long it shows, which is until the hit unless `for` says otherwise. */
    for: number;
}

/** Reads `headmarker: <look> at -<lead> [for <duration>]`, or returns why it can't. */
function readHeadmarkerField(value: unknown, headmarkers: ReadonlySet<string>): HeadmarkerField | string {
    const match = typeof value === 'string' ? /^(\S+)\s+at\s+-(\d+(?:\.\d+)?(?:ms|s)?)(?:\s+for\s+(\d+(?:\.\d+)?(?:ms|s)?))?$/.exec(value.trim()) : null;

    if (match == null) return '"headmarker" takes "<look> at -<lead>", optionally followed by "for <duration>", such as "stack at -5s"';
    if (!headmarkers.has(match[1]!)) return `"${match[1]}" isn't a headmarker look: ${[...headmarkers].join(', ')}`;

    const lead = duration(match[2]!);
    const shown = match[3] == null ? lead : duration(match[3]);

    if (lead <= 0 || shown <= 0) return '"headmarker" needs a lead and a duration above 0';

    return { look: match[1]!, lead, for: shown };
}

/** Splits `define` blocks into what each one means. Non-simple values keep the viewer's form, parsed as YAML flow. */
function readDefinitions(definitions: Definition[], actions: Record<string, ActionFacts>, headmarkers: ReadonlySet<string>, error: (line: number, message: string) => void) {
    const actionDefs: Record<string, Record<string, any>> = {};
    const elementDefs: Record<string, Record<string, any>> = {};
    /** The kind of each element definition, by its ID. */
    const elementKinds: Record<string, Definition['kind']> = {};
    const gradients: Record<string, string> = {};
    const strategies: CompiledDiagram['strategies'] = [];

    for (const definition of definitions) {
        // A definition without a body does nothing: what it names stays as it would be without it.
        if (Object.keys(definition.fields).length === 0 && definition.body.length === 0) {
            error(definition.line, `${definition.kind === 'arena' ? '"define arena"' : `"${definition.id}"`} is empty, which does nothing: give it fields or remove it`);
            continue;
        }

        if (definition.kind === 'gradient') {
            gradients[definition.id] = definition.body.join(' ');
            continue;
        }

        const name = definition.fields.name?.[0];

        if (definition.kind === 'strategy') {
            const covers = (definition.fields.covers ?? []).flatMap(line => line.split(',').map(key => key.trim())).filter(key => key !== '');

            if (covers.length === 0) error(definition.line, `strategy "${definition.id}" covers nothing`);

            strategies.push({ id: definition.id, name: name ?? definition.id, covers });
            continue;
        }

        const values: Record<string, unknown> = {};

        for (const [key, lines] of Object.entries(definition.fields)) {
            if (key === 'exit') {
                // `+effect: laser` and the like are statements to run, and anything else is an `exit` animation.
                const [hooks, animations] = [lines.filter(line => /^[+-]/.test(line)), lines.filter(line => line !== '' && !/^[+-]/.test(line))];

                values.hooks = hooks;

                try {
                    if (animations.length > 0) values.exit = readFieldValue(animations.join(' '));
                } catch (e) {
                    error(definition.line, `"${key}" of "${definition.id}" can't be read: ${e instanceof Error ? e.message : e}`);
                }

                continue;
            }

            try {
                values[key] = readFieldValue(lines.join(' '));
            } catch (e) {
                error(definition.line, `"${key}" of "${definition.id}" can't be read: ${e instanceof Error ? e.message : e}`);
            }
        }

        if (definition.kind === 'action') {
            if (actions[definition.id] == null) error(definition.line, `"${definition.id}" isn't an action of the timeline`);
            if ('look' in values) error(definition.line, `"${definition.id}" can't have a "look": AoE looks come from omens.yaml`);

            for (const field of REMOVED_KEYS) {
                if (field in values) error(definition.line, `"${definition.id}" can't have "${field}": it was removed; an action's hit shows only its resolve effect (+effect in exit)`);
            }

            if ('attached' in values && typeof values.attached !== 'boolean' && typeof values.attached !== 'string') error(definition.line, `"attached" of "${definition.id}" is true, false or an actor's key`);

            for (const [key, instead] of Object.entries(MOVED_KEYS)) {
                if (key in values) error(definition.line, `"${definition.id}" can't have a "${key}": ${instead}`);
            }

            if ('headmarker' in values) {
                const headmarker = readHeadmarkerField(values.headmarker, headmarkers);

                if (typeof headmarker === 'string') {
                    error(definition.line, `"${definition.id}": ${headmarker}`);
                    delete values.headmarker;
                } else {
                    values.headmarker = headmarker;
                }
            }

            actionDefs[definition.id] = values;
        } else {
            if ('bnpc' in values) error(definition.line, `"${definition.id}" can't have a "bnpc": ${BNPC_INSTEAD}`);

            readElementType(definition, values, error);
            elementDefs[definition.id] = values;
            elementKinds[definition.id] = definition.kind;
        }
    }

    return { actionDefs, elementDefs, elementKinds, gradients, strategies };
}

/**
 * Checks a definition's `type` against what its kind allows, fills in the type of kinds that have only one, and turns
 * `type: graphic` into the viewer's `marker`. Also checks what only some kinds take: `duration` (puddles).
 */
function readElementType(definition: Definition, values: Record<string, unknown>, error: (line: number, message: string) => void): void {
    const allowed = TYPES_OF_KIND[definition.kind];
    const type = values.type as string | undefined;
    const name = definition.kind === 'arena' ? '"define arena"' : `"${definition.id}"`;

    if ('duration' in values && definition.kind !== 'puddle' && definition.kind !== 'element') error(definition.line, `${name} can't have a "duration": only puddles disappear by themselves`);
    if (allowed == null) return;

    if (type === 'marker') {
        error(definition.line, `${name}: "type: marker" is now "type: graphic"`);
    } else if (type != null && !allowed.includes(type)) {
        error(definition.line, `${name} is a ${definition.kind}, whose type is ${allowed.join(' or ')}`);
    } else if (type == null && allowed.length === 1) {
        values.type = allowed[0];
    } else if (type == null && definition.kind !== 'actor') {
        error(definition.line, `${name} needs a "type": ${allowed.join(', ')}`);
    }

    if (values.type === 'graphic') {
        const look = values.look as string | { type?: string } | undefined;
        const lookName = typeof look === 'string' ? look : look?.type;

        if (lookName == null || !(DDL_MARKER_LOOKS.graphics as readonly string[]).includes(lookName)) {
            error(definition.line, `"${definition.id}" needs a graphic "look": ${DDL_MARKER_LOOKS.graphics.join(', ')}`);
        }

        values.type = 'marker';
    }

    // A prism has no default depth to draw its side and top with.
    if (values.type === 'prism' && typeof values.depth !== 'number') error(definition.line, `"${definition.id}" needs a "depth": prisms are boxes`);
}

/** Compiles a `.diagram` file. Everything wrong with it is returned as a diagnostic, and the result is then incomplete. */
export function compileDiagram(source: string, input: DiagramInput): { diagram: CompiledDiagram, diagnostics: Diagnostic[] } {
    const { actions, arenas } = input;
    const parsed = parse(source);
    const diagnostics: Diagnostic[] = [...parsed.diagnostics];
    const error = (line: number, message: string) => {
        diagnostics.push({ line, message });
    };
    /** The headmarker looks this diagram can use, and the tether looks it can use without a `define tether`. */
    const headmarkerLooks = new Set<string>(input.headmarkers == null ? DDL_MARKER_LOOKS.headmarkers : [...Object.values(input.headmarkers), 'unknown']);
    const tetherLooks = new Set<string>([...Object.values(input.tethers ?? {}), 'unknown']);
    const { actionDefs, elementDefs, elementKinds, gradients, strategies } = readDefinitions(parsed.definitions, actions, headmarkerLooks, error);
    const definitionLine = (kind: Definition['kind'], id: string) => parsed.definitions.find(d => d.kind === kind && d.id === id)?.line ?? 0;

    for (const definition of parsed.definitions) {
        const attached = actionDefs[definition.id]?.attached;

        if (definition.kind === 'action' && typeof attached === 'string' && input.actors?.[attached] == null) {
            error(definition.line, `"${definition.id}" is attached to "${attached}", which isn't an actor of the timeline`);
        }
    }

    /**
     * The actors an action's AoE sits on and turns with until it hits, or `undefined` if it isn't attached: those that
     * `attached` names (`true` for the action's own actors), and for a raidwide without `attached`, its own actors.
     */
    const attachedActors = (key: string): string[] | undefined => {
        const attached = actionDefs[key]?.attached;

        if (typeof attached === 'string') return [attached];
        if (attached === true || (attached == null && isRaidwide(actions[key]))) return actorsOf(actions[key]);
        return undefined;
    };

    // Skips, branches and strategies come first, since they decide which statements and uses count at all.
    const skips: [number, number][] = [];
    const branches: CompiledDiagram['branches'] = [];
    const scopes = new Map<Statement, Scope>();
    const lastInScope = new Map<string, number>();
    let scope: Scope = {};
    let openGroup: CompiledDiagram['branches'][number] | null = null;
    let openOption: CompiledDiagram['branches'][number]['options'][number] | null = null;
    const body: Statement[] = [];
    const lastTime = parsed.statements.reduce((max, s) => Math.max(max, s.at), 0);
    // Past the last use, so that a skip to the end also covers it.
    const end = Math.max(lastTime, ...input.uses.map(use => use.at)) + 1;

    parsed.statements.forEach((s, index) => {
        if (s.verb === 'skip') {
            skips.push([s.at, parsed.statements[index + 1]?.at ?? end]);
            return;
        }

        if (s.verb === 'strategy') {
            if (s.sign === '-') {
                scope = { ...scope, strategy: undefined };
            } else {
                if (!strategies.some(strategy => strategy.id === s.text)) error(s.line, `unknown strategy "${s.text}"`);

                scope = { ...scope, strategy: s.text };
            }

            return;
        }

        if (s.verb === 'branch') {
            if (s.sign === '-') {
                if (openGroup == null) {
                    error(s.line, '-branch without a +branch');
                } else {
                    openGroup.end = s.at;
                }

                openGroup = null;
                openOption = null;
                scope = { ...scope, branch: undefined };
            } else {
                if (openGroup == null) {
                    openGroup = { at: s.at, end: s.at, options: [] };
                    branches.push(openGroup);
                }

                openOption = { name: s.text, last: s.at };
                openGroup.options.push(openOption);
                scope = { ...scope, branch: [openGroup.at, s.text] };
            }

            return;
        }

        const key = scopeKey(scope);
        const previous = lastInScope.get(key) ?? (scope.branch != null || scope.strategy != null ? -Infinity : lastInScope.get('|') ?? -Infinity);

        // Time restarts in each branch and strategy block, so order only holds within one.
        if (s.at < previous) error(s.line, `${s.at} is out of sequence`);

        lastInScope.set(key, s.at);

        if (openOption != null) openOption.last = Math.max(openOption.last, s.at);

        scopes.set(s, scopeOf(scope));
        body.push(s);
    });

    const inSkip = (t: number) => skips.some(([from, to]) => t >= from && t < to);
    const uses = input.uses.filter(use => !inSkip(use.at)).sort((a, b) => a.at - b.at);
    const elements = new Map<string, CompiledElement>();
    const order: string[] = [];
    const aoes: CompiledAoe[] = [];
    const definitions: CompiledDiagram['definitions'] = {
        [RAIDWIDE_BASE]: { type: 'ellipse', size: RAIDWIDE_SIZE, visible: false, shadow: false },
        [LABEL_BASE]: { type: 'rectangle', planar: false, look: { type: 'none' }, visible: false, shadow: false }
    };
    const keyframes: CompiledDiagram['keyframes'] = branches.map(branch => ({ at: branch.at }));
    const hints: CompiledDiagram['hints'] = [];
    const statuses: CompiledDiagram['statuses'] = [];
    const effects: CompiledDiagram['effects'] = [];
    const thumbnails: CompiledDiagram['thumbnails'] = {};
    const pendingEffects: { use: Use, preset: string }[] = [];

    /**
     * The definition of an element: its `define`; for a timeline actor, the default look, which a definition without a
     * `type` only adjusts (`define actor garuda` with an `opacity` is still the boss icon); for a headmarker or a tether
     * look of `tethers.yaml` without a definition, that look. `tether` says whether the element is a tether, whose look
     * may have the name of a headmarker (`unknown`).
     */
    const elementDef = (base: string, tether: boolean = false): Record<string, any> | undefined => {
        const own = elementDefs[base];

        if (own == null && !tether && headmarkerLooks.has(base)) return { type: 'marker', look: base, size: HEADMARKER_SIZES[base] ?? HEADMARKER_SIZE, shadow: false };
        if (own == null && tether && tetherLooks.has(base)) return { type: 'link', look: base };
        if (input.actors?.[base] == null || own?.type != null) return own;

        return { ...DEFAULT_ACTOR_GRAPHICS, ...own };
    };
    /** What an element is, by its base: the kind of its `define`, or a headmarker, a `tethers.yaml` tether or a timeline actor without one. */
    const kindOf = (base: string, tether: boolean): Definition['kind'] | 'headmarker' | undefined => elementKinds[base]
        ?? (tether ? (tetherLooks.has(base) ? 'tether' : undefined) : headmarkerLooks.has(base) ? 'headmarker' : input.actors?.[base] != null ? 'actor' : undefined);
    /** Adds the definition of the element `id` (or of the base `id`) to the compiled diagram, or reports that it has none. */
    const requireBase = (id: string, line: number) => {
        const base = baseOf(id);

        if (base === RAIDWIDE_BASE) return;

        const def = elementDef(base, id.includes('@'));

        if (def == null && !PLAYERS.includes(base)) {
            error(line, `"${base}" has no definition`);
        } else if (def != null) {
            const { hooks: _hooks, duration: _duration, ...visual } = def;
            definitions[definitionKey(id)] = visual;
        }
    };

    /** The element with this ID, created if it's new. */
    const ensure = (id: string, line: number): CompiledElement => {
        let element = elements.get(id);

        if (element == null) {
            const base = baseOf(id);
            requireBase(id, line);
            element = { id, base, props: {}, spawns: [], poses: [], turns: [], sets: [] };
            elements.set(id, element);
            order.push(id);
        }

        return element;
    };

    const isLive = (element: CompiledElement, t: number, within: Scope) => element.spawns.some(spawn => t >= spawn.from && t < spawn.to && compatible(spawn, within));
    /** The elements of the timeline actors `actors` (`omega`, `omega#2`) alive at `at`, in any scope. */
    const aliveOf = (actors: string[], at: number): CompiledElement[] =>
        [...elements.values()].filter(e => actors.includes(e.base) && e.spawns.some(spawn => at >= spawn.from && at <= spawn.to));

    /** Expands a subject into element IDs, resolving `*` against what's alive at `t`. */
    const expandSubject = (token: string, s: Statement, within: Scope): string[] => expandTemplate(token).flatMap(id => {
        if (!id.includes('*')) return [id];

        const pattern = new RegExp(`^${id.replace(/[.+?^${}()|\\/]/g, '\\$&').replace('*', '.*')}$`);
        const live = [...elements.values()].filter(e => pattern.test(e.id) && isLive(e, s.at, within)).map(e => e.id);

        if (live.length === 0) error(s.line, `"${token}" matches nothing alive at ${s.at}`);

        return live;
    });

    /** Gets a clause's value for the `index`th of `ids`: one value applies to all, otherwise they pair up in order. */
    const valueFor = (values: string[], index: number, ids: string[], s: Statement, within: Scope): string | undefined => {
        const options = values.flatMap(v => v.includes('*') ? expandSubject(v, s, within) : expandTemplate(v));

        if (options.length !== 1 && options.length !== ids.length) {
            error(s.line, `${options.length} values for ${ids.length} subjects`);
        }

        return (options.length === 1 ? options[0] : options[index])?.replaceAll('<id>', subIdOf(ids[index]!));
    };

    const clauseOf = (s: Statement, key: string) => s.clauses.find(c => c.key === key)?.values;

    /** Reads the value of an `at` or `to` clause. A placeholder such as `clocks(63)` gets the spot of the subject, or of its sub-ID in `fist#T1`. */
    const positionOf = (value: string, id: string, line: number): number | string | number[] => {
        try {
            return callPlaceholder(value, subIdOf(id))?.[0] ?? literal(value);
        } catch (e) {
            error(line, `"${id}": ${e instanceof Error ? e.message : e}`);
            return [0, 0];
        }
    };

    /** Plane units per yalm at `t`, from the arena image of that time. */
    const unitsPerYalm = (t: number): XY => {
        const arena = arenas.findLast(item => item.at <= t) ?? arenas[0];

        if (arena?.imageSize == null || input.arenaSize == null) return DEFAULT_UNITS_PER_YALM;

        const box = (elementDefs.arena?.size ?? DEFAULT_ARENA_BOX) as number | [number, number];
        const boxSize: XY = typeof box === 'number' ? [box, box] : box;
        return planeUnitsPerYalm(arena.imageSize, expandMargin(arena.margin ?? 0), boxSize, [1, 1], input.arenaSize);
    };

    /** What an AoE drawn by an element with this definition covers at `t`, in plane units. */
    const areaOf = (definition: Record<string, unknown>, t: number, visual: Record<string, unknown>, yalms: [number, number] | undefined): AoeArea | undefined => {
        const type = definition.type as string | undefined;
        const kind = type === 'rectangle' ? 'rectangle' : type === 'cone' ? 'cone' : type === 'donut' ? 'donut' : type === 'ellipse' || type === 'marker' ? 'circle' : undefined;
        const [unitsX, unitsY] = unitsPerYalm(t);
        const stated = (visual.size ?? definition.size) as number | [number, number] | undefined;
        const size: XY | undefined = yalms != null ? [yalms[0] * unitsX, yalms[1] * unitsY] : typeof stated === 'number' ? [stated, stated] : stated;

        if (kind == null || size == null) return undefined;

        const scale = (visual.scale ?? definition.scale ?? 1) as number | [number, number];
        const [scaleX, scaleY] = typeof scale === 'number' ? [scale, scale] : scale;
        const origin = (visual.origin ?? definition.origin ?? 0.5) as number | [number, number];

        // A donut's size is its inner and outer diameter.
        if (kind === 'donut') {
            return { kind, size: [size[1] * scaleX, size[1] * scaleY], origin: [0.5, 0.5], inner: size[0] / 2 * scaleX };
        }

        return {
            kind,
            size: [size[0] * scaleX, size[1] * scaleY],
            origin: typeof origin === 'number' ? [origin, origin] : origin,
            ...(kind === 'cone' ? { angle: (visual.angle ?? definition.angle) as number } : {})
        };
    };

    /** The arena's larger side in yalms, if the fight's arena size is known. */
    const arenaYalms = input.arenaSize == null ? undefined : Math.max(...input.arenaSize);

    const lastDestination = (element: CompiledElement, within: Scope): XY => {
        for (let i = element.poses.length - 1; i >= 0; i--) {
            const pose = element.poses[i]!;

            if (!compatible(pose, within)) continue;
            if (pose.kind === 'fixed') return pose.xy;
            if (pose.kind === 'move' && typeof pose.to !== 'string') return pose.to;
        }

        return [0, 0];
    };

    const addMotion = (element: CompiledElement, s: Statement, id: string, index: number, ids: string[], within: Scope) => {
        const over = clauseOf(s, 'over');
        const overMs = over == null ? null : duration(valueFor(over, index, ids, s, within)!);
        const to = clauseOf(s, 'to');

        if (to != null) {
            const raw = positionOf(valueFor(to, index, ids, s, within)!, id, s.line);
            const target: XY | string = Array.isArray(raw) ? toXY(raw) : String(raw);
            const isPlayer = PLAYERS.includes(id);

            if (!isPlayer && overMs == null) error(s.line, `"${id}" isn't a player, so its ${s.verb} needs "over"`);
            if (typeof target === 'string' && isPlayer && overMs == null) error(s.line, `"${id}" moving to an element needs "over"`);

            const from = lastDestination(element, within);
            const [unitsX, unitsY] = unitsPerYalm(s.at);
            const run = typeof target === 'string' ? 0 : Math.hypot((target[0] - from[0]) / unitsX, (target[1] - from[1]) / unitsY) / RUN_SPEED;
            // Speeding up and slowing down costs one ramp, or if it never reaches run speed, as long as the distance takes that way.
            const time = overMs ?? (run >= MOTION_RAMP ? run + MOTION_RAMP : 2 * Math.sqrt(run * MOTION_RAMP));
            let start = s.verb === 'arrive' ? s.at - time : s.at;
            // A placement counts too: the latest pose to start decides the position, so a move starting before one would never show.
            const previousEnd = element.poses.filter(p => compatible(p, within)).at(-1)?.end ?? -Infinity;

            if (start < previousEnd) {
                error(s.line, `${id} needs ${Math.round(time)} ms but its previous move or placement ends at ${Math.round(previousEnd)}, ${Math.round(previousEnd - start)} ms too late`);
                start = previousEnd;
            }

            const finish = s.verb === 'arrive' ? Math.max(s.at, start) : start + time;
            element.poses.push({ ...within, start, end: finish, kind: 'move', to: target, ramp: Math.min(MOTION_RAMP, (finish - start) / 2) });
        }

        const rotate = clauseOf(s, 'rotate');

        if (rotate != null) {
            if (overMs == null) error(s.line, `the rotation of "${id}" needs "over"`);

            element.turns.push({ ...within, t: s.verb === 'arrive' ? s.at - (overMs ?? 0) : s.at, over: overMs ?? 0, by: Number(valueFor(rotate, index, ids, s, within)) });
        }

        addToward(element, s, index, ids, within, overMs ?? 0);
    };

    const addToward = (element: CompiledElement, s: Statement, index: number, ids: string[], within: Scope, over: number = 0) => {
        const toward = clauseOf(s, 'toward');

        if (toward == null) return;

        const value = literal(valueFor(toward, index, ids, s, within)!);
        element.turns.push(typeof value === 'number' ? { ...within, t: s.at, over, abs: value } : { ...within, t: s.at, over, look: String(value) });
    };

    const placedCount = (use: Use, within: Scope) => aoes.filter(a => a.action === use.action && a.hit === use.at && compatible(a, within)).length;
    const expectedCount = (use: Use) => isRaidwide(actions[use.action]) ? 1 : use.count ?? actions[use.action]?.count ?? 1;

    /**
     * Adds one placement of an action at one use. `variant` is the game action ID that `as` draws it as instead, whose
     * shape, size and look this placement takes; its timing stays the action's.
     */
    const addAoe = (id: string, use: Use, shown: number | null, within: Scope, fields: Partial<CompiledAoe>, line: number, variant?: number): CompiledAoe => {
        const action = actions[use.action] ?? {};
        const variantFacts = variant == null ? undefined : input.variants?.[variant];

        if (variant != null && variantFacts == null) error(line, `no game data for the action ${variant} that "${id}" is drawn as`);

        // The variant replaces what game data says, but what only the timeline says, such as its shape, stays.
        const drawnFacts: ActionFacts = variantFacts == null ? action : { ...action, ...variantFacts, shape: action.shape };
        const def = actionDefs[use.action] ?? {};
        const raidwide = isRaidwide(action);
        const omen = action.hasOmen === true && (action.cast ?? 0) > 0;
        const telegraphStart = use.at - (action.cast ?? 0) + (action['omen-delay'] ?? 0);
        const show = raidwide ? use.at : omen ? telegraphStart : shown ?? telegraphStart;
        const visual: Record<string, unknown> = Object.fromEntries(Object.entries(def).filter(([key]) => !NON_VISUAL_KEYS.has(key)));
        // Raidwides have no outline, so they keep their own look.
        const omenLook = drawnFacts.omen != null ? input.omens?.[drawnFacts.omen] : undefined;
        let look: Record<string, unknown> = raidwide ? {} : { look: omenLook ?? 'aoe' };
        const drawn = raidwide ? undefined : drawnShape(drawnFacts, arenaYalms);

        if (typeof drawn === 'string') error(line, `"${use.action}" ${drawn}`);

        let base: string | undefined = raidwide ? RAIDWIDE_BASE : drawn == null || typeof drawn === 'string' || drawn.type === 'parts' ? undefined : AOE_BASES[drawn.type];
        const omenLookName = typeof omenLook === 'string' ? omenLook : (omenLook as { type?: string } | undefined)?.type;
        // A look that is a built-in drawing, such as `tower`, draws that over the AoE's circle.
        const graphic = !raidwide && omenLookName != null && (DDL_MARKER_LOOKS.aoes as readonly string[]).includes(omenLookName);

        if (graphic && base != null && typeof drawn === 'object' && drawn?.type === 'ellipse') {
            base = AOE_GRAPHIC_BASE;
        } else if (graphic && drawn != null && typeof drawn !== 'string') {
            error(line, `"${use.action}" looks like "${omenLookName}" by its omen, which only draws circles`);
            look = { look: 'aoe' };
        }
        const unique = `${use.action}-${subIdOf(id) === id ? 'all' : subIdOf(id)}-${use.at}`;
        const key = scopeKey(within);
        const existing = aoes.filter(a => a.action === use.action && a.id === id && a.hit === use.at);

        if (existing.some(a => scopeKey(a) === key)) error(line, `"${id}" at ${use.at} is placed twice`);

        const suffix = existing.length > 0 ? `-${key.replace(/[^\w-]/g, '')}` : '';
        const aoe: CompiledAoe = {
            ...within,
            id,
            action: use.action,
            show,
            hit: use.at,
            omen,
            raidwide,
            // A drawing has no outline to dash.
            props: { ...visual, ...look, ...(omen || raidwide || base === AOE_GRAPHIC_BASE ? {} : DASHED) },
            labelId: `${LABEL_BASE}#${unique}${suffix}`,
            label: action.name ?? use.action,
            ...fields
        };

        if (raidwide) {
            aoe.renderId = `${RAIDWIDE_BASE}#${unique}${suffix}`;
        } else if (base != null && drawn != null && typeof drawn !== 'string' && drawn.type !== 'parts') {
            // `drawn` decides the size and the area; `base` may be the drawing that stands in for its circle.
            aoe.renderId = `${base}#${unique}${suffix}`;
            definitions[base] = AOE_DEFINITIONS[base]!;
            aoe.props.yalms = drawn.yalms;

            if (drawn.angle != null) aoe.props.angle = drawn.angle;
            if (drawn.fade != null) aoe.props.fade = drawn.fade;

            // A line of unknown width hits no one by itself.
            const area = drawn.fade != null ? undefined : areaOf(AOE_DEFINITIONS[base]!, use.at, { ...visual, ...(drawn.angle != null ? { angle: drawn.angle } : {}) }, drawn.yalms);

            if (area != null) aoe.area = area;
        } else if (drawn != null && typeof drawn !== 'string' && drawn.type === 'parts') {
            const [unitsX, unitsY] = unitsPerYalm(use.at);
            const parts: AoePart[] = drawn.parts.map((part, i) => ({
                renderId: `${AOE_PART_BASE}#${unique}-p${i}${suffix}`,
                offset: [part.offset[0] * unitsX, part.offset[1] * unitsY],
                rotate: part.rotate,
                size: [part.size[0] * unitsX, part.size[1] * unitsY]
            }));

            definitions[AOE_PART_BASE] = AOE_DEFINITIONS[AOE_PART_BASE]!;
            // Its rectangles form one outline.
            aoe.props.merge = true;
            aoe.parts = parts;
            aoe.area = { kind: 'composite', size: [0, 0], origin: [0.5, 0.5], parts: parts.map(({ renderId: _, ...part }) => part) };
        }

        if (!raidwide) {
            const drawnBase = aoe.renderId != null ? base : undefined;
            const definition = drawnBase == null ? undefined : AOE_DEFINITIONS[drawnBase] ?? elementDefs[drawnBase];
            const yalms = aoe.props.yalms as XY | undefined;
            const facing = definition == null ? 0 : facingOf({ ...definition, ...visual, ...(yalms != null ? { size: yalms } : {}) });

            if (facing !== 0) aoe.facing = facing;
        }

        aoes.push(aoe);
        return aoe;
    };

    /** Each `+follow`, until its `-follow`, the next `+follow` of the same actor, or the end. */
    const follows: { id: string, from: number, to: number, target: string, chase: boolean, line: number, within: Scope }[] = [];
    /** Each `turn`: toward something for `over`, held for `hold`, and back over `over` again. */
    const awayTurns: { id: string, at: number, toward: string, over: number, hold: number, line: number }[] = [];
    const openHints = new Map<string, CompiledDiagram['hints'][number]>();
    /** The line of each hint's `+hint`, for its errors. */
    const hintLines = new Map<CompiledDiagram['hints'][number], number>();
    /** Each `+headmarker`'s spawn, with its element and line, for the error about those that are never removed. */
    const headmarkerSpawns: { id: string, spawn: Spawn, line: number }[] = [];
    const lastKeyframes = new Map<string, number>();

    /** Applies one statement. `effectTarget` is the element whose `exit` hook this statement comes from. */
    const run = (s: Statement, within: Scope, effectTarget?: string, hookUse?: Use): void => {
        const subjects = () => s.subjects.flatMap(token => expandSubject(token, s, within));

        switch (s.verb) {
            case 'keyframe': {
                const key = scopeKey(within);
                const gap = s.at - (lastKeyframes.get(key) ?? -Infinity);

                if (gap >= 0 && gap < MIN_KEYFRAME_GAP) error(s.line, `keyframe at ${s.at} is only ${gap} ms after the previous one`);

                keyframes.push({ ...within, at: s.at });
                lastKeyframes.set(key, s.at);
                break;
            }
            case 'thumbnail':
                if (thumbnails[s.text] != null) error(s.line, `"${s.text}" already has a thumbnail at ${thumbnails[s.text]}`);

                thumbnails[s.text] = s.at;
                break;
            case 'hint': {
                const key = scopeKey(within);
                const open = openHints.get(key);

                if (open != null) open.to = s.at;

                openHints.delete(key);

                if (s.sign === '+') {
                    const hint = { ...within, from: s.at, to: Infinity, text: s.text };
                    openHints.set(key, hint);
                    hintLines.set(hint, s.line);
                    hints.push(hint);
                }
                break;
            }
            case 'effect': {
                const name = s.subjects[0] ?? '';
                const preset = EFFECT_ALIASES[name] ?? name;

                if (!(RESOLVE_PRESETS as readonly string[]).includes(preset)) error(s.line, `unknown effect "${name}"`);

                if (hookUse != null) {
                    pendingEffects.push({ use: hookUse, preset });
                    break;
                }

                const on = clauseOf(s, 'on')?.[0] ?? effectTarget;

                if (on == null) {
                    error(s.line, `+effect "${name}" has no "on"`);
                } else {
                    effects.push({ ...within, at: s.at, target: on, preset });
                }
                break;
            }
            case 'status': {
                const on = clauseOf(s, 'on')?.flatMap(expandTemplate);

                for (const name of s.subjects) {
                    if (s.sign === '-') {
                        const open = statuses.filter(x => x.name === name && x.to === Infinity && (on == null || on.includes(x.player)) && compatible(x, within));

                        if (open.length === 0) error(s.line, `no active "${name}" to remove`);

                        open.forEach(x => {
                            x.to = s.at;
                        });
                    } else {
                        if (on == null) error(s.line, `+status "${name}" has no "on"`);

                        for (const player of on ?? []) statuses.push({ ...within, player, name, from: s.at, to: Infinity });
                    }
                }
                break;
            }
            case 'actor':
            case 'object':
            case 'puddle':
            case 'headmarker':
            case 'tether': {
                const ids = subjects();

                ids.forEach((id, index) => {
                    const base = baseOf(id);
                    const kind = kindOf(base, s.verb === 'tether');

                    if (s.verb === 'actor' && s.sign === '+' && input.actors?.[base] == null && !PLAYERS.includes(id)) {
                        error(s.line, `"${base}" isn't an actor of the timeline`);
                    }

                    if (s.verb === 'headmarker' && kind !== 'headmarker') {
                        error(s.line, `"${base}" isn't a headmarker: ${[...headmarkerLooks].join(', ')}`);
                        return;
                    }

                    // The removed `define element` is reported where it's defined, and may be placed by any verb.
                    if (kind != null && kind !== 'element' && kind !== (KIND_OF_VERB[s.verb] ?? s.verb) && !PLAYERS.includes(id)) {
                        error(s.line, `"${base}" is ${kind === 'arena' ? 'the arena' : `defined as a ${kind}`}, so it can't be placed with "${s.sign}${s.verb}"`);
                    }

                    if (s.verb === 'headmarker' && s.sign === '+' && clauseOf(s, 'on') == null) error(s.line, `+headmarker "${id}" needs "on": the actor or player it marks`);

                    const element = ensure(id, s.line);

                    if (s.sign === '-') {
                        // Alive, which a puddle with a `duration` may still be.
                        const open = element.spawns.find(spawn => s.at >= spawn.from && s.at < spawn.to && compatible(spawn, within));

                        if (open == null) {
                            error(s.line, `"${id}" isn't alive at ${s.at}`);
                        } else {
                            open.to = s.at;
                        }

                        for (const line of (elementDef(element.base, element.id.includes('@'))?.hooks ?? []) as string[]) {
                            for (const hooked of parse(`${s.at} ${line}`).statements) run({ ...hooked, line: s.line }, within, id);
                        }

                        return;
                    }

                    // A puddle with a `duration` disappears by itself.
                    const lifetime = s.verb === 'puddle' ? elementDef(base)?.duration as string | number | undefined : undefined;
                    const spawn = { ...within, from: s.at, to: lifetime == null ? Infinity : s.at + duration(String(lifetime)) };
                    element.spawns.push(spawn);

                    if (s.verb === 'headmarker') headmarkerSpawns.push({ id, spawn, line: s.line });

                    if (s.verb === 'tether') {
                        // `far-tether@T1>R2`: a tether refers to its two ends, and points from the first to the second.
                        const [from, to, ...rest] = id.includes('@') ? id.slice(id.indexOf('@') + 1).split('>') : [];

                        if (from == null || to == null || from === '' || to === '' || rest.length > 0) {
                            error(s.line, `tether "${id}" needs the form name@A>B, such as far-tether@T1>R2`);
                        } else {
                            element.link = { from, to };
                        }

                        return;
                    }

                    for (const clause of s.clauses) {
                        const value = valueFor(clause.values, index, ids, s, within)!;

                        if (clause.key === 'at') {
                            const raw = positionOf(value, id, s.line);
                            const offset = clauseOf(s, 'offset');
                            const xy = offset == null ? [0, 0] : literal(valueFor(offset, index, ids, s, within)!) as number[];
                            element.poses.push(Array.isArray(raw)
                                ? { ...within, start: s.at, end: s.at, kind: 'fixed', xy: toXY(raw) }
                                : { ...within, start: s.at, end: s.at, kind: 'snap', target: String(raw), snapAt: s.at, offset: xy as XY });
                        } else if (clause.key === 'on') {
                            const offset = clauseOf(s, 'offset');
                            const xy = offset == null ? [0, 0] : literal(valueFor(offset, index, ids, s, within)!) as number[];
                            element.poses.push({ ...within, start: s.at, end: s.at, kind: 'follow', target: value, offset: xy as XY });
                        } else if (clause.key === 'as') {
                            const text = literal(value);

                            if (text !== '' && text === input.actors?.[baseOf(id)]?.name) {
                                error(s.line, `"${id}" is labelled "${text}" anyway, since that's its name in the timeline's "actors"`);
                            }

                            element.props.text = text;
                        } else if (clause.key === 'bnpc') {
                            error(s.line, `"${id}" can't have a "bnpc": ${BNPC_INSTEAD}`);
                        } else if (clause.key !== 'toward' && clause.key !== 'offset') {
                            element.props[clause.key] = literal(value);
                        }
                    }

                    addToward(element, s, index, ids, within);
                });
                break;
            }
            case 'aoe': {
                const ids = subjects();

                ids.forEach((id, index) => {
                    const action = baseOf(id);
                    const facts = actions[action];

                    if (facts == null) error(s.line, `unknown action "${action}"`);

                    const use = uses.find(u => u.action === action && u.at >= s.at && placedCount(u, within) < expectedCount(u));

                    if (use == null) {
                        error(s.line, `no later use of "${action}" for this placement`);
                        return;
                    }

                    const fields: Partial<CompiledAoe> = {};
                    const on = clauseOf(s, 'on');
                    const at = clauseOf(s, 'at');
                    const toward = clauseOf(s, 'toward');
                    const attachedTo = attachedActors(action);

                    // A raidwide is only attached by itself while nothing places it.
                    if (attachedTo != null && !(isRaidwide(facts) && actionDefs[action]?.attached == null)) {
                        // An actor's element with the placement's sub-ID, or else the only one alive.
                        const actors = attachedTo;
                        const alive = aliveOf(actors, use.at);
                        const withSub = alive.filter(e => subIdOf(e.id) === subIdOf(id) && e.id !== e.base);
                        const anchor = withSub.length === 1 ? withSub[0] : withSub.length === 0 && alive.length === 1 ? alive[0] : undefined;
                        const names = actors.map(actor => `"${actor}"`).join(' or ');

                        if (actors.length === 0) {
                            error(s.line, `"${action}" is attached, but its timeline action has no "actor"`);
                        } else if (anchor == null) {
                            error(s.line, `"${id}" is attached to ${names}, but neither exactly one of them with the sub-ID "${subIdOf(id)}" nor a single one is alive at ${use.at}`);
                        } else {
                            fields.attachedTo = anchor.id;
                        }
                    }

                    if (on != null) fields.on = valueFor(on, index, ids, s, within);

                    if (at != null) {
                        const raw = positionOf(valueFor(at, index, ids, s, within)!, id, s.line);
                        fields.at =Array.isArray(raw) ? toXY(raw) : String(raw);
                    }

                    if (toward != null) {
                        // An angle, or an element to aim at as it stands when the telegraph appears.
                        const value = literal(valueFor(toward, index, ids, s, within)!);
                        fields.toward = typeof value === 'number' ? value : String(value);
                    }

                    // Unlike the other clauses, this one lists who it hits rather than pairing up with the subjects.
                    const hits = clauseOf(s, 'hits');

                    if (hits != null) {
                        fields.hits = hits.flatMap(expandTemplate).map(hit => hit.replaceAll('<id>', subIdOf(id)));
                    }

                    const as = clauseOf(s, 'as');
                    const variant = as == null ? undefined : Number(valueFor(as, index, ids, s, within));

                    if (variant != null && !Number.isInteger(variant)) error(s.line, `"as" on +aoe takes a game action ID`);

                    const aoe = addAoe(id, use, s.at, within, fields, s.line, variant);

                    if (aoe.omen && s.at > aoe.show) error(s.line, `"${id}" is placed ${s.at - aoe.show} ms after its telegraph appears`);
                });
                break;
            }
            case 'depart':
            case 'arrive': {
                const ids = subjects();
                ids.forEach((id, index) => addMotion(ensure(id, s.line), s, id, index, ids, within));
                break;
            }
            case 'set': {
                const ids = subjects();

                ids.forEach((id, index) => {
                    const element = ensure(id, s.line);
                    const over = clauseOf(s, 'over');
                    const overMs = over == null ? 0 : duration(valueFor(over, index, ids, s, within)!);
                    addToward(element, s, index, ids, within, overMs);

                    for (const clause of s.clauses) {
                        if (clause.key !== 'toward' && clause.key !== 'over') {
                            element.sets.push({ ...within, t: s.at, over: overMs, key: clause.key, value: literal(valueFor(clause.values, index, ids, s, within)!) });
                        }
                    }
                });
                break;
            }
            case 'follow':
                for (const id of subjects()) {
                    ensure(id, s.line);
                    const open = follows.find(f => f.id === id && f.to === Infinity && compatible(f.within, within));

                    if (s.sign === '-') {
                        if (open == null) error(s.line, `"${id}" isn't following anything at ${s.at}`);
                        else open.to = s.at;

                        continue;
                    }

                    const [on, toward] = [clauseOf(s, 'on')?.[0], clauseOf(s, 'toward')?.[0]];

                    if ((on == null) === (toward == null)) {
                        error(s.line, '+follow needs either "on" (to chase and turn) or "toward" (to turn only)');
                        continue;
                    }

                    // A new target replaces the old one, as in a tank swap.
                    if (open != null) open.to = s.at;

                    follows.push({ id, from: s.at, to: Infinity, target: (on ?? toward)!, chase: on != null, line: s.line, within });
                }

                break;
            case 'turn':
                subjects().forEach((id, index, ids) => {
                    const [toward, over, hold] = [clauseOf(s, 'toward'), clauseOf(s, 'over'), clauseOf(s, 'for')];

                    if (toward == null) {
                        error(s.line, 'turn needs "toward"');
                        return;
                    }

                    awayTurns.push({
                        id,
                        at: s.at,
                        toward: valueFor(toward, index, ids, s, within)!,
                        over: over == null ? 0 : duration(valueFor(over, index, ids, s, within)!),
                        hold: hold == null ? 0 : duration(valueFor(hold, index, ids, s, within)!),
                        line: s.line
                    });
                });

                break;
            default:
                error(s.line, `"${s.verb}" isn't supported`);
        }
    };

    /**
     * Plays out each `+follow` over its target's known path and writes it as ordinary poses and turns, since seeking
     * is a pure function of time and can't simulate. A follower turns toward its target (at most at `FOLLOW_TURN_SPEED`) and, with `on`, chases it at its
     * `speed` until it's within its `reach`. While it casts an action whose `actor` it is (see `castersOf`), and through the action's
     * attack animation after that (`animationLock`), it holds still, and only turns if the action `tracks`. During a `turn`, it holds still and turns away and back.
     */
    function simulateFollows(): void {
        const sorted = (element: CompiledElement): CompiledElement => ({ ...element, poses: [...element.poses].sort((a, b) => a.start - b.start), turns: [...element.turns].sort((a, b) => a.t - b.t) });
        const unwrap = (angle: number, near: number) => angle + 360 * Math.round((near - angle) / 360);
        const frontToward = (from: XY, to: XY, near: number) => unwrap(Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180 / Math.PI, near);

        for (const turn of awayTurns) {
            if (!follows.some(f => f.id === turn.id && turn.at >= f.from && turn.at < f.to)) error(turn.line, `"${turn.id}" turns back to what it follows, but follows nothing at ${turn.at}`);
        }

        for (const follow of [...follows].sort((a, b) => a.from - b.from)) {
            const element = elements.get(follow.id)!;
            const to = Math.min(follow.to, end);
            const props: Record<string, unknown> = { ...elementDef(element.base), ...element.props };
            const hitbox = input.hitboxes?.[element.base];

            // Tools such as the editor need to know, since nothing else may move or turn it then.
            (element.follows ??= []).push({ from: follow.from, to, target: follow.target, line: follow.line });

            if (follow.chase && hitbox == null) {
                error(follow.line, `"${follow.id}" needs a hitbox to chase "${follow.target}": "${element.base}" must be an actor of the timeline with an "id"`);
                continue;
            }

            for (const pose of element.poses) {
                if (pose.start > follow.from && pose.start < to) error(follow.line, `"${follow.id}" follows "${follow.target}" from ${follow.from} to ${to}, so it can't also be placed or moved at ${pose.start}`);
            }

            for (const turn of element.turns) {
                if (turn.t > follow.from && turn.t < to) error(follow.line, `"${follow.id}" follows "${follow.target}" from ${follow.from} to ${to}, so it can't also be turned at ${turn.t}; use "turn"`);
            }

            // Only what `positionAt` and `rotationAt` read.
            const diagram = { elements: Object.fromEntries([...elements.values()].map(e => [e.id, sorted(e)])), aoes } as unknown as CompiledDiagram;
            const speed = Number(props.speed ?? DEFAULT_FOLLOW_SPEED);
            const reach = Number(props.reach ?? DEFAULT_REACH);
            const facing = facingOf(props);
            // From the cast's start to the end of the attack animation that follows it, which instant actions play too.
            const locks = uses.filter(use => castersOf(use).some(caster => caster.id === follow.id)).flatMap(use => {
                const cast = actions[use.action]?.cast ?? 0;
                const lock = actions[use.action]?.animationLock ?? 0;
                return cast + lock > 0 ? [{ from: use.at - cast, to: use.at + lock, tracks: actionDefs[use.action]?.tracks === true }] : [];
            });
            const turns = awayTurns.filter(turn => turn.id === follow.id && turn.at >= follow.from && turn.at < to).map(turn => ({ ...turn, start: NaN }));
            let [x, y] = positionAt(diagram, follow.id, follow.from);
            let front = rotationAt(diagram, follow.id, follow.from) + facing;
            const samples: [t: number, x: number, y: number, front: number][] = [[follow.from, x, y, front]];
            // Steady steps, plus where each hold starts and ends, so that nothing moves a moment too early or late.
            const edges = [...locks.flatMap(l => [l.from, l.to]), ...turns.flatMap(turn => [turn.at, turn.at + turn.over, turn.at + turn.over + turn.hold, turn.at + 2 * turn.over + turn.hold])];
            const times = [...new Set([...Array.from({ length: Math.floor((to - follow.from) / FOLLOW_STEP) }, (_, i) => follow.from + (i + 1) * FOLLOW_STEP), ...edges.filter(t => t > follow.from && t <= to)])].sort((a, b) => a - b);
            let previous = follow.from;

            for (const t of times) {
                const elapsed = t - previous;
                previous = t;
                const target = positionAt(diagram, follow.target, t);
                const followed = frontToward([x, y], target, front);
                const lock = locks.find(l => t > l.from && t <= l.to);
                const away = turns.find(turn => t > turn.at && t <= turn.at + 2 * turn.over + turn.hold);

                if (away != null) {
                    if (Number.isNaN(away.start)) away.start = front;

                    const facingAway = /^-?\d/.test(away.toward) ? unwrap(Number(away.toward), front) : frontToward([x, y], positionAt(diagram, away.toward, t), front);
                    const phase = t - away.at;

                    front = phase < away.over ? away.start + (facingAway - away.start) * phase / away.over
                        : phase <= away.over + away.hold ? facingAway
                        : facingAway + (followed - facingAway) * Math.min(1, (phase - away.over - away.hold) / Math.max(away.over, 1));
                } else {
                    if (lock == null || lock.tracks) front += Math.max(-FOLLOW_TURN_SPEED * elapsed, Math.min(FOLLOW_TURN_SPEED * elapsed, followed - front));

                    if (follow.chase && lock == null) {
                        const [unitsX, unitsY] = unitsPerYalm(t);
                        const [dx, dy] = [(target[0] - x) / unitsX, (target[1] - y) / unitsY];
                        const distance = Math.hypot(dx, dy);
                        const gap = distance - hitbox! - PLAYER_ICON_RADIUS - reach;

                        if (gap > 0) {
                            const step = Math.min(speed * elapsed / 1000, gap);
                            x += dx / distance * step * unitsX;
                            y += dy / distance * step * unitsY;
                        }
                    }
                }

                samples.push([t, x, y, front]);
            }

            // A sample that lies halfway between its neighbours, as on a straight run at a steady speed or while standing still, adds nothing.
            const halfway = (a: number, b: number, c: number) => Math.abs(b - (a + c) / 2) < 0.01;
            const kept = samples.filter((sample, i) => i === 0 || i === samples.length - 1
                || !sample.every((value, k) => halfway(samples[i - 1]![k]!, value, samples[i + 1]![k]!)));

            for (let i = 1; i < kept.length; i++) {
                const [from, , , previousFront] = kept[i - 1]!;
                const [t, px, py, sampleFront] = kept[i]!;
                const [lastX, lastY] = [kept[i - 1]![1], kept[i - 1]![2]];

                if (px !== lastX || py !== lastY) element.poses.push({ ...follow.within, start: from, end: t, kind: 'move', to: [px, py], ramp: 0 });
                if (sampleFront !== previousFront) element.turns.push({ ...follow.within, t: from, over: t - from, abs: sampleFront });
            }
        }
    }

    // Action hooks become ordinary statements at each use of the action.
    const hooked: { statement: Statement, use: Use }[] = uses.flatMap(use => ((actionDefs[use.action]?.hooks ?? []) as string[])
        .flatMap(line => parse(`${use.at} ${line}`).statements.map(statement => ({ statement: { ...statement, line: 0 }, use }))));
    const timed = [
        ...body.map(statement => ({ statement, use: undefined as Use | undefined })),
        ...hooked
    ].sort((a, b) => a.statement.at - b.statement.at);

    for (const { statement, use } of timed) {
        run(statement, scopes.get(statement) ?? {}, undefined, use);
    }

    if (arenas.length > 0) requireBase('arena', 0);

    addNameLabels([...elements.values()], base => elementDef(base)?.image === BOSS_IMAGE ? input.actors?.[base] : undefined);

    /** Who casts a use: every alive element of its action's actors, except the helper's, whose casts show nothing. */
    const castersOf = (use: Use): { id: string, scope: Scope }[] =>
        aliveOf(actorsOf(actions[use.action]).filter(actor => input.actors?.[actor]?.id != null), use.at).map(e => ({ id: e.id, scope: {} }));

    // Every use must have the right number of placements, unless an action hook covers it.
    for (const use of uses) {
        const action = actions[use.action] ?? {};
        const def = actionDefs[use.action];
        const placed = aoes.filter(a => a.action === use.action && a.hit === use.at);
        // Only a parent that deals no damage of its own and isn't an AoE in game data just groups its children; anything else is a hit like any other.
        // So does one whose `hit` is one of its children: they are the hits, at their real times.
        const isShell = ((action.children?.length ?? 0) > 0 && !((action.damage ?? 0) > 0) && !((action.castType ?? 0) >= 2))
            || (action.hit != null && (action.children ?? []).some(child => actions[child.id]?.id === action.hit));
        const raidwide = isRaidwide(action);

        if (action.shape == null && !raidwide) continue;

        const attachedTo = attachedActors(use.action);

        if (attachedTo != null && placed.length === 0 && !isShell) {
            // A raidwide hits once, from its first live caster.
            const alive = aliveOf(attachedTo, use.at);
            const actors = raidwide ? alive.slice(0, 1) : alive;
            const names = attachedTo.map(actor => `"${actor}"`).join(' or ');

            if (attachedTo.length === 0) error(0, raidwide ? `raidwide "${use.action}" at ${use.at} has no origin: place it, or give its timeline action an "actor"` : `"${use.action}" is attached, but its timeline action has no "actor"`);
            else if (actors.length === 0) error(0, raidwide ? `raidwide "${use.action}" at ${use.at} has no origin: none of ${names} is alive then` : `"${use.action}" at ${use.at} is attached to ${names}, but none is alive then`);

            for (const actor of actors) addAoe(`${use.action}#${subIdOf(actor.id)}`, use, null, {}, { attachedTo: actor.id }, 0);

            continue;
        }

        if (raidwide) {
            if (placed.length === 0) error(0, `raidwide "${use.action}" at ${use.at} has no origin`);

            continue;
        }

        if (isShell && placed.length === 0) continue;

        if (placed.length === 0) {
            error(0, `"${use.action}" at ${use.at} isn't placed`);
            continue;
        }

        const expected = expectedCount(use);

        // Each strategy or branch places the use by itself, on top of what's shared.
        const scoped = new Set(placed.filter(a => scopeKey(a) !== '|').map(a => scopeKey(a)));
        const counts = scoped.size === 0 ? [placed.length] : [...scoped].map(key => placed.filter(a => scopeKey(a) === key || scopeKey(a) === '|').length);

        if (counts.some(count => count !== expected)) error(0, `"${use.action}" at ${use.at} has ${counts.join('/')} placements for a count of ${expected}`);
    }

    for (const aoe of aoes) {
        /** What makes this placement's own elements unique: its label's ID without the label's base. */
        const unique = aoe.labelId.slice(aoe.labelId.indexOf('#') + 1);

        // `headmarker:` marks what the AoE is placed on, `lead` before its hit, until the hit or for its own duration.
        const mark = actionDefs[aoe.action]?.headmarker as HeadmarkerField | undefined;

        if (mark != null) {
            const anchor = aoe.on ?? aoe.attachedTo;

            if (anchor == null) {
                error(definitionLine('action', aoe.action), `the headmarker of "${aoe.action}" needs an AoE placed "on" something or attached to an actor, but "${aoe.id}" at ${aoe.hit} is neither`);
                continue;
            }

            const element = ensure(`${mark.look}#${unique}`, definitionLine('action', aoe.action));
            const from = aoe.hit - mark.lead;

            element.spawns.push({ ...scopeOf(aoe), from, to: from + mark.for });
            element.poses.push({ ...scopeOf(aoe), start: from, end: from, kind: 'follow', target: anchor, offset: [0, 0] });
        }
    }

    // A headmarker that stays until the end of the fight is a missing `-headmarker`. Once per statement and
    // headmarker, however many strategies or branches it's in.
    const unremovedHeadmarkers = new Set<string>();

    for (const { id, spawn, line } of headmarkerSpawns) {
        if (spawn.to !== Infinity || unremovedHeadmarkers.has(`${line} ${id}`)) continue;

        unremovedHeadmarkers.add(`${line} ${id}`);
        error(line, `headmarker "${id}" is never removed: add a -headmarker where it goes away`);
    }

    simulateFollows();

    // What hits leaves a resolve effect: the one its hook names, otherwise a plain flash. A raidwide sweeps.
    for (const aoe of aoes) {
        const named = pendingEffects.filter(effect => effect.use.action === aoe.action && effect.use.at === aoe.hit);
        // A composite plays its effect on each of its rectangles.
        const targets = aoe.parts?.map(part => part.renderId) ?? [aoe.renderId].filter(target => target != null);

        for (const target of targets) {
            for (const preset of named.length > 0 ? named.map(effect => effect.preset) : [aoe.raidwide ? 'sweep' : 'flash']) {
                effects.push({ ...scopeOf(aoe), at: aoe.hit, target, preset });
            }
        }
    }

    for (const element of elements.values()) {
        const props: Record<string, unknown> = { ...elementDef(element.base, element.id.includes('@')), ...element.props };
        const facing = facingOf(props);

        if (facing !== 0) element.facing = facing;

        // A timeline actor with a BNpcBase is as big as its hitbox, so the ring of the boss icon is the hitbox's edge.
        const hitbox = input.hitboxes?.[element.base];

        if (hitbox != null) {
            if (element.props.size != null || element.props.scale != null) error(0, `"${element.id}" is sized from the hitbox of its actor, so it can't also have a size or scale`);

            const ring = props.image === BOSS_IMAGE ? BOSS_RING : 1;
            element.props.yalms = [2 * hitbox / ring, 2 * hitbox / ring];
        }

        element.poses.sort((a: Pose, b: Pose) => a.start - b.start);
        element.turns.sort((a, b) => a.t - b.t);
        element.sets.sort((a, b) => a.t - b.t);

        for (const spawn of element.spawns) {
            if (spawn.to === Infinity) spawn.to = end;
        }

        for (const pose of element.poses) {
            const target = pose.kind === 'follow' || pose.kind === 'snap' ? pose.target : pose.kind === 'move' && typeof pose.to === 'string' ? pose.to : null;

            if (target != null && !PLAYERS.includes(target) && !elements.has(target) && !aoes.some(a => a.id === target)) {
                error(0, `"${element.id}" refers to unknown "${target}"`);
            }
        }
    }

    // Players always exist, and the viewer's player icons need no definition.
    for (const player of PLAYERS) {
        if (!elements.has(player)) {
            elements.set(player, { id: player, base: player, props: {}, spawns: [], poses: [], turns: [], sets: [] });
            order.push(player);
        }
    }

    for (const aoe of aoes) {
        if (typeof aoe.at === 'string' && !PLAYERS.includes(aoe.at) && !elements.has(aoe.at)) error(0, `"${aoe.id}" refers to unknown "${aoe.at}"`);
        if (aoe.on != null && !PLAYERS.includes(aoe.on) && !elements.has(aoe.on)) error(0, `"${aoe.id}" refers to unknown "${aoe.on}"`);
        if (typeof aoe.toward === 'string' && !PLAYERS.includes(aoe.toward) && !elements.has(aoe.toward)) error(0, `"${aoe.id}" turns toward unknown "${aoe.toward}"`);

        for (const hit of aoe.hits ?? []) {
            if (!elements.has(hit)) error(0, `"${aoe.id}" hits unknown "${hit}"`);
        }
    }

    for (const effect of effects) {
        if (elements.get(effect.target)?.link != null) error(0, `effect "${effect.preset}" can't play on the tether "${effect.target}"`);
    }

    for (const hint of hints) {
        if (hint.to === Infinity) hint.to = end;
        if (hint.to - hint.from < MIN_HINT_DURATION) error(hintLines.get(hint) ?? 0, `this hint shows for only ${hint.to - hint.from} ms, but needs at least ${MIN_HINT_DURATION} ms to be read`);
    }

    for (const status of statuses) {
        if (status.to === Infinity) status.to = end;
    }

    keyframes.sort((a, b) => a.at - b.at);

    // Strategy dialogs play from the strategy's action to its last child, or to the next keyframe without children.
    const clips: CompiledDiagram['clips'] = {};

    for (const strategy of strategies) {
        for (const key of strategy.covers) {
            const use = uses.find(u => u.strategies?.includes(key) || actions[u.action]?.strategies?.[key] != null);

            if (use == null) {
                error(0, `strategy "${strategy.id}" covers "${key}", but no action that isn't skipped has it`);
                continue;
            }

            if (thumbnails[key] == null) error(0, `covered strategy "${key}" has no thumbnail`);

            clips[key] = { from: use.at, to: use.lastChild ?? keyframes.find(k => k.at > use.at)?.at ?? end };
        }
    }

    const waymarks: CompiledDiagram['waymarks'] = {};

    for (const [key, set] of Object.entries(input.waymarks ?? {})) {
        try {
            waymarks[key] = Object.fromEntries(Object.entries(resolveWaymarks(set)).map(([id, position]) => [id.replace('waymark-', 'marker-'), toXY(position)]));
        } catch (e) {
            error(0, `waymark set "${key}": ${e instanceof Error ? e.message : e}`);
        }
    }

    let ghosts: Record<string, GhostTrack> | undefined;

    if (input.ghosts != null) {
        const toPlane = (samples: [number, number, number][]) => samples.map(([at, x, y]): [number, number, number] => {
            const [unitsX, unitsY] = unitsPerYalm(at);
            return [at, x * unitsX, y * unitsY];
        });

        definitions[GHOST_BASE] = { type: 'image', size: GHOST_SIZE, origin: [0.5, 0.5], opacity: 0.55, filter: 'grayscale(1)', shadow: false, visible: false };
        ghosts = {
            ...Object.fromEntries(Object.entries(input.ghosts.players).map(([role, track]) => [`${GHOST_BASE}#${role}`, { image: `/images/job-icons/${track.job}.svg`, samples: toPlane(track.samples) }])),
            ...Object.fromEntries(Object.entries(SHOW_ENEMY_GHOSTS ? input.ghosts.bosses : {}).map(([boss, track]) => {
                const hidden = hiddenRanges(boss, input.targetability ?? []);

                return [`${GHOST_BASE}#${boss.replaceAll(' ', '-')}`, { image: '/images/boss.svg', samples: toPlane(track.samples), ...(hidden.length > 0 ? { hidden } : {}) }];
            }))
        };
    }

    const name = (id: string) => actions[id]?.name ?? id;
    // Each caster shows its own cast bar, so that an add's cast doesn't hide the boss's. A use whose action has no actor with an `id` has no bar.
    const casts: CompiledDiagram['casts'] = [];

    for (const use of uses) {
        const cast = actions[use.action]?.cast ?? 0;

        if (cast <= 0) continue;

        for (const caster of castersOf(use)) {
            if (!casts.some(c => c.caster === caster.id && c.to === use.at && scopeKey(c) === scopeKey(caster.scope))) {
                casts.push({ ...caster.scope, caster: caster.id, from: use.at - cast, to: use.at, text: name(use.action) });
            }
        }
    }

    const diagram: CompiledDiagram = {
        ...(ghosts != null ? { ghosts } : {}),
        end,
        start: skips.reduce((t, [from, to]) => t >= from && t < to ? to : t, 0),
        definitions,
        gradients,
        elements: Object.fromEntries(elements),
        order,
        aoes,
        keyframes,
        chapters: uses.filter(use => use.parent == null && actions[use.action]?.emphasis === 'more').map(use => ({ at: use.at, id: use.action, name: name(use.action), ...(use.lastChild != null ? { end: use.lastChild } : {}) })),
        hints,
        statuses,
        statusInfo: {},
        effects: effects.sort((a, b) => a.at - b.at),
        mechanics: uses.map(use => ({ at: use.at, id: use.action, name: name(use.action), ...(use.parent != null ? { parent: use.parent } : {}) })),
        casts,
        strategies,
        branches,
        clips,
        thumbnails,
        skips,
        arenas,
        ...(input.arenaSize != null ? { arenaSize: input.arenaSize } : {}),
        waymarks
    };

    return { diagram, diagnostics };
}
