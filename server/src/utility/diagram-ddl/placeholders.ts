// Scaffolding for function-style placeholders in the timeline's `waymarks`, such as `waymark-letters: clocks(63)`.

/** A position as [distance, degrees]. */
export type Position = [number, number];

/**
 * The `clocks` placeholder. Its logic is written by the author, so this body is intentionally blank.
 * Its arguments are passed exactly as written in the file.
 */
export function clocks(..._args: number[]): Position[] | void {
}

/** The waymarks that each group key stands for, in the order that a placeholder's positions are assigned to them. */
const GROUPS: Record<string, string[]> = {
    'waymark-letters': ['waymark-a', 'waymark-b', 'waymark-c', 'waymark-d'],
    'waymark-numbers': ['waymark-1', 'waymark-2', 'waymark-3', 'waymark-4']
};

const PLACEHOLDERS: Record<string, (...args: number[]) => Position[] | void> = { clocks };

/** Turns one waymark set from the timeline into `{ waymark-a: [distance, degrees], ... }`, calling placeholders as needed. */
export function resolveWaymarks(set: Record<string, unknown>): Record<string, Position> {
    const result: Record<string, Position> = {};

    for (const [key, value] of Object.entries(set)) {
        if (key === 'name') continue;

        if (Array.isArray(value)) {
            result[key] = value as Position;
            continue;
        }

        const call = /^(\w+)\(([^)]*)\)$/.exec(String(value));
        const fn = call == null ? undefined : PLACEHOLDERS[call[1]!];

        if (fn == null) throw new Error(`Unknown waymark value "${value}" on ${key}`);

        const args = call![2]!.split(',').filter(a => a.trim() !== '').map(Number);
        const positions = fn(...args);

        if (positions == null) throw new Error(`"${call![1]}" on ${key} isn't implemented yet`);

        positions.forEach((position, i) => {
            result[GROUPS[key]?.[i] ?? `${key}-${i}`] = position;
        });
    }

    return result;
}
