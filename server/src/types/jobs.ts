type ExtractElements<T> = T extends readonly string[]
    ? T
    : T extends Record<string, infer U>
        ? T & ExtractElements<U>
        : never;

function makeObjectArray<T>(object: T): ExtractElements<T> {
    const array: string[] = [];

    for (const key in object) {
        Object.defineProperty(array, key, {
            enumerable: false,
            value: object[key]
        });

        if (Array.isArray(object[key])) {
            array.push(...object[key] as string[]);
        }
    }

    return array as ExtractElements<T>;
}

export const jobs = makeObjectArray({
    tanks: makeObjectArray(['PLD', 'WAR', 'DRK', 'GNB'] as const),
    healers: makeObjectArray({
        pure: makeObjectArray(['WHM', 'AST'] as const),
        barrier: makeObjectArray(['SCH', 'SGE'] as const)
    }),
    dps: makeObjectArray({
        melee: makeObjectArray({
            striking: ['MNK', 'SAM'] as const,
            scouting: ['NIN', 'VPR'] as const,
            maiming: ['DRG', 'RPR'] as const
        }),
        pranged: ['BRD', 'MCH', 'DNC'] as const,
        caster: ['BLM', 'SMN', 'RDM', 'PCT'] as const
    })
});

export type Job = typeof jobs[number];
