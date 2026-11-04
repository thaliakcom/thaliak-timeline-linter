// Function-style placeholders, such as `waymark-letters: clocks(63)` in the timeline's `waymarks` and `arrive: <players> to clocks(63)` in a `.diagram` file.

/** A position as [distance, degrees]. */
export type Position = [number, number];
export type LetterWaymarkKey = `waymark-${'a' | 'b' | 'c' | 'd'}`;
export type NumberWaymarkKey = `waymark-${'1' | '2' | '3' | '4'}`;
export type WaymarkKey = LetterWaymarkKey | NumberWaymarkKey;
export type TankKey = 'T1' | 'T2';
export type HealerKey = 'H1' | 'H2';
export type MeleeKey = 'M1' | 'M2';
export type RangedKey = 'R1' | 'R2';
export type PlayerKey = TankKey | HealerKey | MeleeKey | RangedKey;

const DEFAULT_WAYMARKS: Record<WaymarkKey, number> = {
    'waymark-a': 0,
    'waymark-2': 45,
    'waymark-b': 90,
    'waymark-3': 135,
    'waymark-c': 180,
    'waymark-4': -135,
    'waymark-d': -90,
    'waymark-1': -45
};

const DEFAULT_CLOCKS: Record<PlayerKey, number> = {
    T1: 0,
    R2: 45,
    H2: 90,
    M2: 135,
    T2: 180,
    M1: -135,
    H1: -90,
    R1: -45
};

/** Wraps an angle in degrees into the range (-180, 180], so that -180 becomes 180. */
function normalizeAngle(degrees: number): number {
    const wrapped = ((degrees % 360) + 360) % 360;

    return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * The `clocks` placeholder: the default clock spot of a player or waymark, or of each member of a group,
 * at the given distance from the centre and rotated clockwise by `angleOffset` degrees.
 * The positions of a group are in the order of its group array.
 */
export function clocks(key: string, distance?: number, angleOffset: number = 0): Position[] {
    if (distance == null) {
        throw new Error('The clocks() placeholder expects a distance argument.');
    }

    const playerGroup = PLAYER_GROUPS[key];

    if (playerGroup != null) {
        return playerGroup.map(key => [distance, normalizeAngle(DEFAULT_CLOCKS[key]! + angleOffset)]);
    }

    const playerAngle = DEFAULT_CLOCKS[key as PlayerKey];

    if (playerAngle != null) {
        return [[distance, normalizeAngle(playerAngle + angleOffset)]];
    }

    const waymarkGroup = WAYMARK_GROUPS[key];

    if (waymarkGroup != null) {
        return waymarkGroup.map(key => [distance, normalizeAngle(DEFAULT_WAYMARKS[key] + angleOffset)]);
    }

    const waymarkAngle = DEFAULT_WAYMARKS[key as WaymarkKey];

    if (waymarkAngle != null) {
        return [[distance, normalizeAngle(waymarkAngle + angleOffset)]];
    }

    throw new Error('The clocks() function cannot be used in this context.');
}

/** The waymarks that each group key stands for, in the order that a placeholder's positions are assigned to them. */
const WAYMARK_GROUPS: Record<string, WaymarkKey[]> = {
    'waymarks': Object.keys(DEFAULT_WAYMARKS) as WaymarkKey[],
    'waymark-letters': ['waymark-a', 'waymark-b', 'waymark-c', 'waymark-d'],
    'waymark-numbers': ['waymark-1', 'waymark-2', 'waymark-3', 'waymark-4']
};

/** The players that each group key stands for. The compiler's `.diagram` groups and player list come from here. */
export const PLAYER_GROUPS: Record<string, PlayerKey[]> = {
    'players': Object.keys(DEFAULT_CLOCKS) as PlayerKey[],
    'tanks': ['T1', 'T2'],
    'healers': ['H1', 'H2'],
    'melees': ['M1', 'M2'],
    'rangeds': ['R1', 'R2'],
    'group-1': ['T1', 'H1', 'M1', 'R1'],
    'group-2': ['T2', 'H2', 'M2', 'R2'],
    'supports': ['T1', 'T2', 'H1', 'H2'],
    'dps': ['M1', 'M2', 'R1', 'R2']
};

const PLACEHOLDERS: Record<string, (key: string, ...args: number[]) => Position[]> = { clocks };

/** Calls the placeholder that `value` names, such as `clocks(63)`, for `key`. Returns `undefined` if `value` isn't a placeholder call. */
export function callPlaceholder(value: string, key: string): Position[] | undefined {
    const call = /^(\w+)\(([^)]*)\)$/.exec(value);
    const fn = call == null ? undefined : PLACEHOLDERS[call[1]!];

    return fn?.(key, ...call![2]!.split(',').filter(a => a.trim() !== '').map(Number));
}

/** Turns one waymark set from the timeline into `{ waymark-a: [distance, degrees], ... }`, calling placeholders as needed. */
export function resolveWaymarks(set: Record<string, unknown>): Record<string, Position> {
    const result: Record<string, Position> = {};

    for (const [key, value] of Object.entries(set)) {
        if (key === 'name') continue;

        if (Array.isArray(value)) {
            result[key] = value as Position;
            continue;
        }

        const positions = callPlaceholder(String(value), key);

        if (positions == null) throw new Error(`Unknown waymark value "${value}" on ${key}`);
        if (DEFAULT_CLOCKS[key as PlayerKey] != null || PLAYER_GROUPS[key] != null) throw new Error(`"${key}" isn't a waymark`);

        positions.forEach((position, i) => {
            result[WAYMARK_GROUPS[key]?.[i] ?? key] = position;
        });
    }

    return result;
}
