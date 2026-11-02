// Turns a parsed `.diagram` file and the fight's actions into plain JSON that `seek.ts` can read,
// and reports everything that makes the file invalid. Runs at build time only.
import * as yaml from 'js-yaml';
import { RESOLVE_PRESETS } from '../../components/diagram/render/effects/presets';
import type { ElementDefinition } from '../../types/graphing';
import { actionYalms, planeUnitsPerYalm } from '../diagram-sizing';
import { expandMargin } from '../margin';
import { Definition, Diagnostic, parse, Statement } from './parse';
import { resolveWaymarks } from './placeholders';
import type { Margin } from '../../types/graphing';
import { AoeArea, ArenaChange, CompiledAoe, CompiledDiagram, CompiledElement, GhostTrack, MOTION_RAMP, Pose, Scope, XY } from './seek';

/** Run speed in yalms per ms. */
const RUN_SPEED = 6 / 1000;
/** Plane units per yalm where a fight's arena can't say, which is only without an arena image or arena size. */
const DEFAULT_UNITS_PER_YALM: XY = [5, 5];
/** The size of the arena's box unless its definition says otherwise, as in `DEFAULT_GRAPHICS.arena`. */
const DEFAULT_ARENA_BOX = 200;
const MIN_KEYFRAME_GAP = 1000;
/** How long the hit's element of an AoE stays, unless its definition says otherwise. */
const DEFAULT_HOLD = 800;
/** The definition of ghosts: slightly transparent and desaturated. */
const GHOST_BASE = 'ghost';
const GHOST_SIZE = 7.5;
const RAIDWIDE_BASE = 'diagram-raidwide';
/** The element that shows an action's name as it hits. */
const LABEL_BASE = 'diagram-label';
/** Large enough for a sweep from the arena's edge to reach the far edge. */
const RAIDWIDE_SIZE = 420;
const DASHED = { look: { type: 'none' }, stroke: { style: 'dashed', color: '#fce76e' } };
/** Definition keys that describe a placement rather than the drawn element. */
const NON_VISUAL_KEYS = new Set(['telegraph', 'flash', 'hold', 'hidden', 'use', 'hooks', 'flashLook']);
/** Effect names without a preset of their own yet. */
const EFFECT_ALIASES: Record<string, string> = { laser: 'wave-cannon' };
/** Elements that the viewer defines by itself. */
const BUILT_IN_BASES = new Set(['boss', 'enemy']);
const PLAYERS = ['T1', 'T2', 'H1', 'H2', 'M1', 'M2', 'R1', 'R2'];
const GROUPS: Record<string, string[]> = {
    '<players>': PLAYERS,
    '<tanks>': ['T1', 'T2'],
    '<healers>': ['H1', 'H2'],
    '<melees>': ['M1', 'M2'],
    '<rangeds>': ['R1', 'R2']
};

/** The facts about an action that a diagram needs. */
export interface ActionFacts {
    name?: string;
    shape?: string;
    mechanic?: string;
    count?: number;
    /** The cast in ms. */
    cast?: number;
    /** The radius or length in yalms. */
    effectRange?: number;
    /** The width in yalms of a rectangular AoE. */
    xAxisModifier?: number;
    hasOmen?: boolean;
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
}

const toXY = ([d, a]: number[]): XY => [d! * Math.sin(a! * Math.PI / 180), -d! * Math.cos(a! * Math.PI / 180)];
const subIdOf = (id: string) => id.includes('#') ? id.slice(id.indexOf('#') + 1) : id;
const baseOf = (id: string) => id.includes('#') ? id.slice(0, id.indexOf('#')) : id;
const duration = (value: string) => value.endsWith('ms') ? parseFloat(value) : value.endsWith('s') ? parseFloat(value) * 1000 : Number(value);
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

/** Identifies a scope, for grouping items by it. */
function scopeKey(scope: Scope): string {
    return `${scope.strategy ?? ''}|${scope.branch?.join(':') ?? ''}`;
}

/** Only the scope's set keys, so that unscoped items stay small in the JSON. */
function scopeOf(scope: Scope): Scope {
    return { ...(scope.strategy != null ? { strategy: scope.strategy } : {}), ...(scope.branch != null ? { branch: scope.branch } : {}) };
}

/** Splits `define` blocks into what each one means. Non-simple values keep the viewer's form, parsed as YAML flow. */
function readDefinitions(definitions: Definition[], actions: Record<string, ActionFacts>, error: (line: number, message: string) => void) {
    const actionDefs: Record<string, Record<string, any>> = {};
    const elementDefs: Record<string, Record<string, any>> = {};
    const gradients: Record<string, string> = {};
    const strategies: CompiledDiagram['strategies'] = [];

    for (const definition of definitions) {
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

                if (animations.length > 0) values.exit = yaml.load(animations.join(' '));

                continue;
            }

            try {
                values[key] = yaml.load(lines.join(' '));
            } catch (e) {
                error(definition.line, `"${key}" of "${definition.id}" can't be read: ${e}`);
            }
        }

        (actions[definition.id] != null ? actionDefs : elementDefs)[definition.id] = values;
    }

    return { actionDefs, elementDefs, gradients, strategies };
}

/** Compiles a `.diagram` file. Everything wrong with it is returned as a diagnostic, and the result is then incomplete. */
export function compileDiagram(source: string, input: DiagramInput): { diagram: CompiledDiagram, diagnostics: Diagnostic[] } {
    const { actions, arenas } = input;
    const parsed = parse(source);
    const diagnostics: Diagnostic[] = [...parsed.diagnostics];
    const error = (line: number, message: string) => {
        diagnostics.push({ line, message });
    };
    const { actionDefs, elementDefs, gradients, strategies } = readDefinitions(parsed.definitions, actions, error);

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

    const elementDef = (base: string) => elementDefs[base];
    const requireBase = (base: string, line: number) => {
        if (base === RAIDWIDE_BASE) return;

        const def = elementDef(base);

        if (def == null && !BUILT_IN_BASES.has(base) && !PLAYERS.includes(base)) {
            error(line, `"${base}" has no element definition`);
        } else if (def != null) {
            const { hooks: _hooks, ...visual } = def;
            definitions[base] = visual;
        }
    };

    /** The element with this ID, created if it's new. */
    const ensure = (id: string, line: number): CompiledElement => {
        let element = elements.get(id);

        if (element == null) {
            const base = baseOf(id);
            requireBase(base, line);
            element = { id, base, props: {}, spawns: [], poses: [], turns: [], sets: [] };
            elements.set(id, element);
            order.push(id);
        }

        return element;
    };

    const isLive = (element: CompiledElement, t: number, within: Scope) => element.spawns.some(spawn => t >= spawn.from && t < spawn.to && compatible(spawn, within));

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

    /** Plane units per yalm at `t`, from the arena image of that time. */
    const unitsPerYalm = (t: number): XY => {
        const arena = arenas.findLast(item => item.at <= t) ?? arenas[0];

        if (arena?.imageSize == null || input.arenaSize == null) return DEFAULT_UNITS_PER_YALM;

        const box = (elementDefs.arena?.size ?? DEFAULT_ARENA_BOX) as number | [number, number];
        const boxSize: XY = typeof box === 'number' ? [box, box] : box;
        return planeUnitsPerYalm(arena.imageSize, expandMargin(arena.margin ?? 0), boxSize, [1, 1], input.arenaSize);
    };

    /** The size of an action's element in yalms from game data, unless its definition states a size. */
    const yalmsOf = (base: string, use: Use, line: number): { yalms?: [number, number] } => {
        if (actionDefs[use.action]?.size != null) return {};

        const facts = actions[use.action];
        const type = elementDefs[base]?.type as ElementDefinition['type'] | undefined;
        // A marker that stands for an AoE, such as Hello World's, covers its circle.
        const yalms = type == null ? undefined : actionYalms((type as string) === 'marker' ? 'ellipse' : type, facts?.effectRange ?? 0, facts?.xAxisModifier);

        if (yalms == null) error(line, `"${use.action}" as a ${type} can't be sized from its effectRange of ${facts?.effectRange ?? 0} and XAxisModifier of ${facts?.xAxisModifier ?? 0}: state a size`);

        return yalms == null ? {} : { yalms: [...yalms] as [number, number] };
    };

    /** What an AoE drawn by the element `base` covers at `t`, in plane units. */
    const areaOf = (base: string, use: Use, t: number, visual: Record<string, unknown>, yalms: [number, number] | undefined): AoeArea | undefined => {
        const definition = elementDefs[base] ?? {};
        const type = definition.type as string | undefined;
        const kind = type === 'rectangle' ? 'rectangle' : type === 'cone' ? 'cone' : type === 'ellipse' || type === 'marker' ? 'circle' : undefined;
        const [unitsX, unitsY] = unitsPerYalm(t);
        const stated = (visual.size ?? definition.size) as number | [number, number] | undefined;
        const size: XY | undefined = yalms != null ? [yalms[0] * unitsX, yalms[1] * unitsY] : typeof stated === 'number' ? [stated, stated] : stated;

        if (kind == null || size == null) return undefined;

        const scale = (visual.scale ?? definition.scale ?? 1) as number | [number, number];
        const [scaleX, scaleY] = typeof scale === 'number' ? [scale, scale] : scale;
        const origin = (visual.origin ?? definition.origin ?? 0.5) as number | [number, number];

        return {
            kind,
            size: [size[0] * scaleX, size[1] * scaleY],
            origin: typeof origin === 'number' ? [origin, origin] : origin,
            ...(kind === 'cone' ? { angle: (visual.angle ?? definition.angle) as number } : {})
        };
    };

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
            const raw = literal(valueFor(to, index, ids, s, within)!);
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

    /** Adds one placement of an action at one use. */
    const addAoe = (id: string, use: Use, shown: number | null, within: Scope, fields: Partial<CompiledAoe>, line: number): CompiledAoe => {
        const action = actions[use.action] ?? {};
        const def = actionDefs[use.action] ?? {};
        const raidwide = isRaidwide(action);
        const omen = action.hasOmen === true && (action.cast ?? 0) > 0;
        const telegraphStart = use.at - (action.cast ?? 0) + (action['omen-delay'] ?? 0);
        const show = raidwide ? use.at : omen ? telegraphStart : shown ?? telegraphStart;
        const visual: Record<string, unknown> = Object.fromEntries(Object.entries(def).filter(([key]) => !NON_VISUAL_KEYS.has(key)));
        const base = raidwide ? RAIDWIDE_BASE : (def.telegraph ?? 'circle') as string;
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
            hold: (def.hold as number | undefined) ?? DEFAULT_HOLD,
            omen,
            raidwide,
            props: { ...visual, ...(omen || raidwide ? {} : DASHED) },
            labelId: `${LABEL_BASE}#${unique}${suffix}`,
            label: action.name ?? use.action,
            ...fields
        };

        if (!def.hidden || raidwide) {
            aoe.renderId = `${base}#${unique}${suffix}`;
            requireBase(base, line);

            if (!raidwide) {
                const { yalms } = yalmsOf(base, use, line);

                if (yalms != null) aoe.props.yalms = yalms;

                const area = areaOf(base, use, use.at, visual, yalms);

                if (area != null) aoe.area = area;
            }
        }

        if (def.flash != null) {
            const flash = def.flash as string;
            aoe.flashId = `${flash}#${unique}-hit${suffix}`;
            const { yalms } = yalmsOf(flash, use, line);
            aoe.flashProps = { ...visual, ...(def.flashLook as object | undefined), ...(yalms != null ? { yalms } : {}) };
            requireBase(flash, line);

            // What only shows as its hit, such as Hello World, covers what that shows.
            if (aoe.area == null && !raidwide) {
                const area = areaOf(flash, use, use.at, visual, yalms);

                if (area != null) aoe.area = area;
            }
        }

        aoes.push(aoe);
        return aoe;
    };

    const openHints = new Map<string, CompiledDiagram['hints'][number]>();
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
            case 'marker':
            case 'tether': {
                const ids = subjects();

                ids.forEach((id, index) => {
                    const element = ensure(id, s.line);

                    if (s.sign === '-') {
                        const open = element.spawns.find(spawn => spawn.to === Infinity && compatible(spawn, within));

                        if (open == null) {
                            error(s.line, `"${id}" isn't alive at ${s.at}`);
                        } else {
                            open.to = s.at;
                        }

                        for (const line of (elementDef(element.base)?.hooks ?? []) as string[]) {
                            for (const hooked of parse(`${s.at} ${line}`).statements) run({ ...hooked, line: s.line }, within, id);
                        }

                        return;
                    }

                    element.spawns.push({ ...within, from: s.at, to: Infinity });

                    if (s.verb === 'tether') {
                        const [from, to] = subIdOf(id).split('/');

                        if (from == null || to == null) {
                            error(s.line, `tether "${id}" needs a sub-ID of the form A/B`);
                        } else {
                            element.link = { from, to };
                        }

                        return;
                    }

                    for (const clause of s.clauses) {
                        const value = valueFor(clause.values, index, ids, s, within)!;

                        if (clause.key === 'at') {
                            const raw = literal(value);
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
                            element.props.text = literal(value);
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
                    if (actionDefs[action] == null && !isRaidwide(facts)) error(s.line, `"${action}" has no definition`);

                    const use = uses.find(u => u.action === action && u.at >= s.at && placedCount(u, within) < expectedCount(u));

                    if (use == null) {
                        error(s.line, `no later use of "${action}" for this placement`);
                        return;
                    }

                    const fields: Partial<CompiledAoe> = {};
                    const on = clauseOf(s, 'on');
                    const at = clauseOf(s, 'at');
                    const toward = clauseOf(s, 'toward');
                    const usePattern = actionDefs[action]?.use as string | undefined;

                    if (usePattern != null) fields.use = usePattern.replace('[*]', subIdOf(id));
                    if (on != null) fields.on = valueFor(on, index, ids, s, within);

                    if (at != null) {
                        const raw = literal(valueFor(at, index, ids, s, within)!);
                        fields.at = Array.isArray(raw) ? toXY(raw) : String(raw);
                    }

                    if (toward != null) fields.toward = Number(valueFor(toward, index, ids, s, within));

                    // Unlike the other clauses, this one lists who it hits rather than pairing up with the subjects.
                    const hits = clauseOf(s, 'hits');

                    if (hits != null) {
                        fields.hits = hits.flatMap(expandTemplate).map(hit => hit.replaceAll('<id>', subIdOf(id)));
                    }

                    const aoe = addAoe(id, use, s.at, within, fields, s.line);

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
            default:
                error(s.line, `"${s.verb}" isn't supported`);
        }
    };

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

    // Every use must have the right number of placements, unless an action hook covers it.
    for (const use of uses) {
        const action = actions[use.action] ?? {};
        const def = actionDefs[use.action];
        const placed = aoes.filter(a => a.action === use.action && a.hit === use.at);
        const isShell = (action.children?.length ?? 0) > 0;
        const raidwide = isRaidwide(action);

        if (action.shape == null && !raidwide) continue;

        if (def?.use != null && placed.length === 0 && !isShell) {
            const pattern = (def.use as string).replace('[*]', '*');
            const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
            const actors = [...elements.values()].filter(e => regex.test(e.id) && e.spawns.some(spawn => use.at >= spawn.from && use.at <= spawn.to));

            if (actors.length === 0) error(0, `"${use.action}" at ${use.at} uses "${def.use}", but nothing like that is alive then`);

            for (const actor of actors) addAoe(`${use.action}#${subIdOf(actor.id)}`, use, null, {}, { use: actor.id }, 0);

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

    // What hits leaves a resolve effect: the one its hook names, otherwise a plain flash. A raidwide sweeps.
    for (const aoe of aoes) {
        const named = pendingEffects.filter(effect => effect.use.action === aoe.action && effect.use.at === aoe.hit);
        const target = aoe.renderId ?? aoe.flashId;

        if (target == null) continue;

        for (const preset of named.length > 0 ? named.map(effect => effect.preset) : aoe.renderId == null ? [] : [aoe.raidwide ? 'sweep' : 'flash']) {
            effects.push({ ...scopeOf(aoe), at: aoe.hit, target, preset });
        }
    }

    for (const element of elements.values()) {
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

        for (const hit of aoe.hits ?? []) {
            if (!elements.has(hit)) error(0, `"${aoe.id}" hits unknown "${hit}"`);
        }
    }

    for (const effect of effects) {
        if (elements.get(effect.target)?.link != null) error(0, `effect "${effect.preset}" can't play on the tether "${effect.target}"`);
    }

    for (const hint of hints) {
        if (hint.to === Infinity) hint.to = end;
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
            ...Object.fromEntries(Object.entries(input.ghosts.bosses).map(([boss, track]) => {
                const hidden = hiddenRanges(boss, input.targetability ?? []);

                return [`${GHOST_BASE}#${boss.replaceAll(' ', '-')}`, { image: '/images/boss.svg', samples: toPlane(track.samples), ...(hidden.length > 0 ? { hidden } : {}) }];
            }))
        };
    }

    const name = (id: string) => actions[id]?.name ?? id;
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
        chapters: uses.filter(use => use.parent == null && actions[use.action]?.emphasis === 'more').map(use => ({ at: use.at, id: use.action, name: name(use.action) })),
        hints,
        statuses,
        statusInfo: {},
        effects: effects.sort((a, b) => a.at - b.at),
        mechanics: uses.map(use => ({ at: use.at, id: use.action, name: name(use.action), ...(use.parent != null ? { parent: use.parent } : {}) })),
        casts: uses.filter(use => (actions[use.action]?.cast ?? 0) > 0).map(use => ({ from: use.at - actions[use.action]!.cast!, to: use.at, text: name(use.action) })),
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
