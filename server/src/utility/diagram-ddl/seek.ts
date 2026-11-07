// The compiled form of a `.diagram` file, and pure functions of time over it. Plain JSON and no closures, so it
// runs in the browser and survives being written into a page.
import type { Margin, StatusInfo } from '../../types/graphing';

export type XY = [number, number];

/** How long a motion speeds up at its start and slows down at its end, in ms, if it lasts long enough. */
export const MOTION_RAMP = 150;

/** The strategy and branch a compiled item belongs to. Unscoped items always apply. */
export interface Scope {
    strategy?: string;
    /** The branch group's start time, and the chosen option's name. */
    branch?: [at: number, name: string];
}

export type Pose = Scope & { start: number, end: number } & (
    | { kind: 'fixed', xy: XY }
    | { kind: 'follow', target: string, offset: XY }
    | { kind: 'snap', target: string, snapAt: number, offset: XY }
    /** `ramp` is how long it speeds up at its start and slows down at its end, in ms. */
    | { kind: 'move', to: XY | string, ramp: number }
);

export type Turn = Scope & { t: number, over: number, abs?: number, by?: number, look?: string };
export type PropSet = Scope & { t: number, over: number, key: string, value: unknown };
export type Spawn = Scope & { from: number, to: number };

/** Anything drawn that has a lifetime of its own: an actor, a marker or a tether. */
export interface CompiledElement {
    id: string;
    base: string;
    props: Record<string, unknown>;
    spawns: Spawn[];
    poses: Pose[];
    turns: Turn[];
    sets: PropSet[];
    link?: { from: string, to: string };
    /** Where its front points when it's drawn unrotated, in degrees clockwise from north. Absent for north. */
    facing?: number;
    /** When it follows something (`+follow`), which decides its position and rotation then. `line` is the `+follow`'s. */
    follows?: { from: number, to: number, target: string, line: number }[];
}

/** One placement of an action's AoE at one use. */
export interface CompiledAoe extends Scope {
    /** The DDL's ID, which elements refer to. Several uses of an action can share it. */
    id: string;
    action: string;
    /** The ID of the telegraph or outline element. Unique to this use. `undefined` if {@link parts} draw it. */
    renderId?: string;
    /** The rectangles that draw a composite AoE (`sides`, `grid`, `plus`, `cross`, `star`), each its own element. */
    parts?: AoePart[];
    /** When the telegraph or outline appears. */
    show: number;
    hit: number;
    /** What the telegraph or outline's element adds to its definition. */
    props: Record<string, unknown>;
    /** A solid telegraph, as opposed to a dashed outline. */
    omen: boolean;
    raidwide: boolean;
    /** The actor element that this AoE sits on and turns with until it hits (`attached` on its action's definition). */
    attachedTo?: string;
    /** An element to follow until the hit. */
    on?: string;
    /** A fixed spot, or an element to snapshot at {@link show}. */
    at?: XY | string;
    /** Where its front points, in degrees clockwise from north, or an element that it aims at as that stands at {@link show}. */
    toward?: number | string;
    /** Where its front points when it's drawn unrotated, in degrees clockwise from north. Absent for north. */
    facing?: number;
    /** What it covers, in plane units, to work out who it hits. A raidwide has none, since it hits everyone. */
    area?: AoeArea;
    /** Who it hits, if the file says so. Otherwise that's whoever stands in its {@link area}. */
    hits?: string[];
    /** The ID of the element that shows the action's name as it hits. */
    labelId: string;
    /** The action's name, which {@link labelId} shows. */
    label: string;
}

/** One rectangle of a composite AoE, centred on its spot. */
export interface AoePart {
    renderId: string;
    /** Where its centre is, in plane units, in the AoE's own frame: before it's turned, with its front pointing north. */
    offset: XY;
    /** How far it's turned within the AoE, in degrees clockwise. */
    rotate: number;
    /** Its width and length in plane units. */
    size: XY;
}

/** What an AoE covers, in the same terms as the element that draws it. */
export interface AoeArea {
    kind: 'circle' | 'rectangle' | 'cone' | 'donut' | 'composite';
    /** The width and height, a cone's radius as the height, or a donut's outer diameter. Unused by a composite. */
    size: XY;
    /** Where its position is within {@link size}, from 0 to 1. Unused by a cone or donut, which centre on their position, or a composite. */
    origin: XY;
    /** A cone's full angle in degrees. */
    angle?: number;
    /** A donut's inner radius in plane units. */
    inner?: number;
    /** A composite's rectangles: it covers whatever any of them covers. */
    parts?: Omit<AoePart, 'renderId'>[];
}

/** An `<arena>` timeline item. */
export interface ArenaChange {
    at: number;
    image: string;
    margin?: Margin;
    /** The image's natural size in pixels. Filled in by the data extension. */
    imageSize?: [number, number];
}

/** Where a pull really had an actor, for authoring. It's drawn as a ghost in dev builds and the editor. */
export interface GhostTrack {
    /** The icon's image. */
    image: string;
    /** `[time, x, y]` in plane units, in time order. */
    samples: [number, number, number][];
    /** The `[from, to)` ranges in which it isn't drawn, as the timeline says that the boss is untargetable. */
    hidden?: [from: number, to: number][];
}

export interface CompiledDiagram {
    end: number;
    /** The time playback starts at: the first one that isn't skipped. */
    start: number;
    /** Ghosts by their element's ID, if the build has any for this fight. */
    ghosts?: Record<string, GhostTrack>;
    /** Element definitions in the viewer's form, by the part of an ID before `#`. */
    definitions: Record<string, Record<string, unknown>>;
    /** Gradients, in the form of the viewer's `defs`. */
    gradients: Record<string, string>;
    elements: Record<string, CompiledElement>;
    /** The IDs of {@link elements}, in the order they're declared. */
    order: string[];
    aoes: CompiledAoe[];
    keyframes: (Scope & { at: number })[];
    /**
     * The `emphasis: more` actions on the timeline itself, not those inside another action. `end` is when the last
     * of its children hits; it has none if it has no children.
     */
    chapters: { at: number, id: string, name: string, end?: number }[];
    hints: (Scope & { from: number, to: number, text: string })[];
    statuses: (Scope & { player: string, name: string, from: number, to: number })[];
    /** What the viewer needs for each status in {@link statuses}, by name. Filled in by the data extension. */
    statusInfo: Record<string, StatusInfo>;
    /** Resolve effects, each on the element whose geometry it takes. */
    effects: (Scope & { at: number, target: string, preset: string })[];
    /** Every action use that isn't skipped, in time order. */
    mechanics: { at: number, id: string, name: string, parent?: string }[];
    /** Cast bars, each drawn above the element that casts it. */
    casts: (Scope & { caster: string, from: number, to: number, text: string })[];
    strategies: { id: string, name: string, covers: string[] }[];
    branches: { at: number, end: number, options: { name: string, last: number }[] }[];
    /** Per strategy key, the part of the timeline its dialog plays. */
    clips: Record<string, { from: number, to: number }>;
    /** Per strategy key, the frame that its thumbnail shows. */
    thumbnails: Record<string, number>;
    /** Ranges that playback jumps over. */
    skips: [from: number, to: number][];
    /** Arena images, in time order. */
    arenas: ArenaChange[];
    /** The fight's arena size in yalms, which sizes are converted with. */
    arenaSize?: [number, number];
    /** Per waymark set, marker element IDs and their spots. */
    waymarks: Record<string, Record<string, XY>>;
}

/** What the player has chosen. */
export interface Selection {
    strategy?: string;
    /** The chosen option's name, per branch group's start time. */
    branches: Record<number, string>;
}

/** Returns whether an item applies under a selection. An unset choice takes the first option of its kind. */
function applies(scope: Scope, diagram: CompiledDiagram, selection: Selection): boolean {
    if (scope.strategy != null && scope.strategy !== (selection.strategy ?? diagram.strategies[0]?.id)) return false;

    if (scope.branch != null) {
        const [at, name] = scope.branch;
        const chosen = selection.branches[at] ?? diagram.branches.find(branch => branch.at === at)?.options[0]?.name;

        if (name !== chosen) return false;
    }

    return true;
}

/**
 * The diagram as it plays under a selection, with only the items that apply. A branch shorter
 * than its group fast-forwards, which is another skip here. The other functions take this.
 */
/** Where a ghost is at `t`, between its samples, or `null` before its first, after its last and while it's hidden. */
export function ghostAt(track: GhostTrack, t: number): XY | null {
    if (track.hidden?.some(([from, to]) => t >= from && t < to)) return null;

    const next = track.samples.findIndex(([at]) => at >= t);

    if (next === -1 || (next === 0 && track.samples[0]![0] > t)) return null;
    if (next === 0) return [track.samples[0]![1], track.samples[0]![2]];

    const [fromAt, fromX, fromY] = track.samples[next - 1]!;
    const [toAt, toX, toY] = track.samples[next]!;
    const progress = (t - fromAt) / (toAt - fromAt);

    return [fromX + (toX - fromX) * progress, fromY + (toY - fromY) * progress];
}

export function select(diagram: CompiledDiagram, selection: Selection): CompiledDiagram {
    const keep = <T extends Scope>(items: T[]) => items.filter(item => applies(item, diagram, selection));
    const elements: CompiledDiagram['elements'] = {};

    for (const [id, element] of Object.entries(diagram.elements)) {
        elements[id] = { ...element, spawns: keep(element.spawns), poses: keep(element.poses), turns: keep(element.turns), sets: keep(element.sets) };
    }

    const fastForwards = diagram.branches.flatMap((branch): [number, number][] => {
        const chosen = selection.branches[branch.at] ?? branch.options[0]?.name;
        const last = branch.options.find(option => option.name === chosen)?.last ?? branch.end;
        return last < branch.end ? [[last, branch.end]] : [];
    });

    return {
        ...diagram,
        elements,
        aoes: keep(diagram.aoes),
        keyframes: keep(diagram.keyframes),
        hints: keep(diagram.hints),
        statuses: keep(diagram.statuses),
        effects: keep(diagram.effects),
        casts: keep(diagram.casts),
        skips: [...diagram.skips, ...fastForwards].sort((a, b) => a[0] - b[0])
    };
}

/**
 * How far along a motion is at `u` (0 to 1), when it speeds up evenly over its first `ramp` (as a fraction
 * of its duration, at most 0.5), moves at a constant speed, and slows down evenly over its last `ramp`.
 */
export function rampProgress(u: number, ramp: number): number {
    if (ramp <= 0) return u;

    const peak = 1 / (1 - ramp);

    if (u < ramp) return peak * u * u / (2 * ramp);
    if (u > 1 - ramp) return 1 - peak * (1 - u) * (1 - u) / (2 * ramp);

    return peak * (u - ramp / 2);
}

/** Finds the AoE that `id` means at `t`: the next one still to hit, otherwise the last one. */
function aoeNamed(diagram: CompiledDiagram, id: string, t: number): CompiledAoe | undefined {
    let last: CompiledAoe | undefined;

    for (const aoe of diagram.aoes) {
        if (aoe.id !== id) continue;
        if (aoe.hit >= t) return aoe;

        last = aoe;
    }

    return last;
}

/** Where a pose in an element's list puts the element at `t`. */
function poseAt(diagram: CompiledDiagram, element: CompiledElement, index: number, t: number): XY {
    const pose = element.poses[index];

    if (pose == null) return [0, 0];

    switch (pose.kind) {
        case 'fixed':
            return pose.xy;
        case 'snap': {
            const [x, y] = positionAt(diagram, pose.target, pose.snapAt);
            return [x + pose.offset[0], y + pose.offset[1]];
        }
        case 'follow': {
            const [x, y] = positionAt(diagram, pose.target, t);
            return [x + pose.offset[0], y + pose.offset[1]];
        }
        case 'move': {
            const to = typeof pose.to === 'string' ? positionAt(diagram, pose.to, t) : pose.to;

            if (t >= pose.end) return to;

            const from = poseAt(diagram, element, index - 1, pose.start);
            const duration = pose.end - pose.start || 1;
            const f = rampProgress((t - pose.start) / duration, pose.ramp / duration);
            return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
        }
    }
}

/** The position of an element or AoE at `t`, in plane units. A tether's position is its middle. */
export function positionAt(diagram: CompiledDiagram, id: string, t: number): XY {
    const element = diagram.elements[id];

    if (element == null) {
        const aoe = aoeNamed(diagram, id, t);
        return aoe == null ? [0, 0] : aoeAt(diagram, aoe, t);
    }

    if (element.link != null) {
        const from = positionAt(diagram, element.link.from, t);
        const to = positionAt(diagram, element.link.to, t);
        return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    }

    let index = -1;

    for (let i = 0; i < element.poses.length; i++) {
        if (element.poses[i]!.start <= t) index = i;
    }

    return poseAt(diagram, element, index, t);
}

/** The position of an AoE at `t`. It moves until it hits, if it's bound to something moving, and stays there after. */
export function aoeAt(diagram: CompiledDiagram, aoe: CompiledAoe, t: number): XY {
    if (aoe.attachedTo != null) return positionAt(diagram, aoe.attachedTo, Math.min(t, aoe.hit));
    if (aoe.on != null) return positionAt(diagram, aoe.on, Math.min(t, aoe.hit));
    if (Array.isArray(aoe.at)) return aoe.at;
    if (typeof aoe.at === 'string') return positionAt(diagram, aoe.at, aoe.show);
    return [0, 0];
}

/** The rotation of an element at `t`, in degrees. */
export function rotationAt(diagram: CompiledDiagram, id: string, t: number): number {
    const element = diagram.elements[id];
    let current = Number(element?.props.rotate ?? 0);

    for (const turn of element?.turns ?? []) {
        if (turn.t > t) break;

        let target = current;

        // `toward` says where the front points, and the element is drawn turned by that minus where its front points unturned.
        if (turn.abs != null) target = turn.abs - (element!.facing ?? 0);
        if (turn.by != null) target = current + turn.by;

        if (turn.look != null) {
            const [x0, y0] = positionAt(diagram, id, turn.t);
            const [x1, y1] = positionAt(diagram, turn.look, turn.t);
            const angle = Math.atan2(x1 - x0, -(y1 - y0)) * 180 / Math.PI - (element!.facing ?? 0);
            // A derived angle has no turn count of its own, so it turns the short way.
            target = angle + 360 * Math.round((current - angle) / 360);
        }

        const f = turn.over > 0 ? rampProgress(Math.min(1, (t - turn.t) / turn.over), Math.min(MOTION_RAMP, turn.over / 2) / turn.over) : 1;
        current += (target - current) * f;
    }

    return current;
}

/** Where an AoE's front points to aim at `target`, both as they stand when the AoE appears, in degrees clockwise from north. */
function aimAt(diagram: CompiledDiagram, aoe: CompiledAoe, target: string): number {
    const [x0, y0] = aoeAt(diagram, aoe, aoe.show);
    const [x1, y1] = positionAt(diagram, target, aoe.show);

    return Math.atan2(x1 - x0, -(y1 - y0)) * 180 / Math.PI;
}

/**
 * The angle an AoE is drawn at, at `t`, in degrees: where its own `toward` says, or else, if it's attached,
 * where its actor's front points until it hits.
 */
export function aoeRotationAt(diagram: CompiledDiagram, aoe: CompiledAoe, t: number): number {
    const front = aoe.attachedTo != null && aoe.toward == null
        ? rotationAt(diagram, aoe.attachedTo, Math.min(t, aoe.hit)) + (diagram.elements[aoe.attachedTo]?.facing ?? 0)
        : typeof aoe.toward === 'string' ? aimAt(diagram, aoe, aoe.toward) : aoe.toward ?? 0;

    return front - (aoe.facing ?? 0);
}

/** Where a part of a composite AoE is at `t`, and its rotation, as {@link aoeAt} and {@link aoeRotationAt} have the AoE's. */
export function partAt(diagram: CompiledDiagram, aoe: CompiledAoe, part: Pick<AoePart, 'offset' | 'rotate'>, t: number): { xy: XY, rotate: number } {
    const [x, y] = aoeAt(diagram, aoe, t);
    const rotate = aoeRotationAt(diagram, aoe, t);
    const r = rotate * Math.PI / 180;
    const [dx, dy] = part.offset;

    return { xy: [x + dx * Math.cos(r) - dy * Math.sin(r), y + dx * Math.sin(r) + dy * Math.cos(r)], rotate: rotate + part.rotate };
}

/** The value of an element's property at `t`. Numbers change gradually over a `set`'s `over`. */
export function propAt(element: CompiledElement, key: string, t: number): unknown {
    let value = element.props[key];

    for (const set of element.sets) {
        if (set.t > t || set.key !== key) continue;

        const f = set.over > 0 ? Math.min(1, (t - set.t) / set.over) : 1;
        value = f < 1 && typeof value === 'number' && typeof set.value === 'number' ? value + (set.value - value) * f : set.value;
    }

    return value;
}

/**
 * The key of an element's definition in {@link CompiledDiagram.definitions}: its ID up to a `#` sub-ID, and for a
 * tether (`far-tether@T1>R2`), up to and including its `@`. Tethers so have names of their own, and the `unknown`
 * tether isn't the `unknown` headmarker.
 */
export function definitionKey(id: string): string {
    const end = id.search(/[#@]/);

    if (end < 0) return id;

    return id[end] === '@' ? id.slice(0, end + 1) : id.slice(0, end);
}

/** An element's definition, by its ID. A tether without one of its own takes its name's, as cast bars (`cast@…`) do. */
export function definitionOf(diagram: Pick<CompiledDiagram, 'definitions'>, id: string): CompiledDiagram['definitions'][string] | undefined {
    const key = definitionKey(id);

    return diagram.definitions[key] ?? (key.endsWith('@') ? diagram.definitions[key.slice(0, -1)] : undefined);
}

/** Returns whether an element is alive at `t`. */
export function isAlive(element: CompiledElement, t: number): boolean {
    return element.spawns.some(spawn => t >= spawn.from && t < spawn.to);
}

/** Returns whether a point in plane units lies in what an AoE covers, at its hit. */
function isInArea(diagram: CompiledDiagram, aoe: CompiledAoe, area: AoeArea, [x, y]: XY): boolean {
    const [ax, ay] = aoeAt(diagram, aoe, aoe.hit);
    const r = aoeRotationAt(diagram, aoe, aoe.hit) * Math.PI / 180;
    // The point in the AoE's own frame, as the renderer rotates an element around its position.
    const dx = x - ax, dy = y - ay;
    const lx = dx * Math.cos(r) + dy * Math.sin(r);
    const ly = -dx * Math.sin(r) + dy * Math.cos(r);
    const [width, height] = area.size;

    if (area.kind === 'composite') {
        // The point in each centred rectangle's own frame.
        return (area.parts ?? []).some(({ offset, rotate, size }) => {
            const p = rotate * Math.PI / 180;
            const [px, py] = [lx - offset[0], ly - offset[1]];
            return Math.abs(px * Math.cos(p) + py * Math.sin(p)) <= size[0] / 2 && Math.abs(-px * Math.sin(p) + py * Math.cos(p)) <= size[1] / 2;
        });
    }

    if (area.kind === 'donut') {
        const distance = Math.hypot(lx, ly);
        return distance <= width / 2 && distance >= (area.inner ?? 0);
    }

    if (area.kind === 'cone') {
        // A cone opens north from its apex.
        const off = Math.abs(Math.atan2(lx, -ly)) * 180 / Math.PI;
        return Math.hypot(lx, ly) <= height && off <= (area.angle ?? 360) / 2;
    }

    const left = lx + area.origin[0] * width;
    const top = ly + area.origin[1] * height;

    if (area.kind === 'rectangle') {
        return left >= 0 && left <= width && top >= 0 && top <= height;
    }

    return ((left - width / 2) / (width / 2)) ** 2 + ((top - height / 2) / (height / 2)) ** 2 <= 1;
}

/**
 * Who each AoE hits, from `targets` (normally the players): everyone for a raidwide, those the file
 * names if it does, otherwise whoever stands in the AoE as it hits. `diagram` is one from `select()`.
 */
export function hitsOf(diagram: CompiledDiagram, targets: readonly string[]): { aoe: CompiledAoe, target: string }[] {
    return diagram.aoes.flatMap(aoe => {
        const hit = aoe.hits ?? (aoe.raidwide ? targets : aoe.area == null ? [] : targets.filter(target => isInArea(diagram, aoe, aoe.area!, positionAt(diagram, target, aoe.hit))));
        return hit.map(target => ({ aoe, target }));
    });
}

/** The time playback should be at instead of `t`, if `t` falls in a skipped range. */
export function afterSkips(diagram: CompiledDiagram, t: number): number {
    for (const [from, to] of diagram.skips) {
        if (t >= from && t < to) return to;
    }

    return t;
}
