export const DEFAULT_GRAPHICS_KEYS = new Set([
    'boss',
    'arena',
    'enemy',
    'cast',
    'hint',
    'marker-a',
    'marker-1',
    'marker-b',
    'marker-2',
    'marker-c',
    'marker-3',
    'marker-d',
    'marker-4'
]);
export const SPECIAL_ELEMENT_KEYS = new Set([
    'players',
    'DPS',
    'tanks',
    'healers',
    'supports',
    'T1',
    'T2',
    'H1',
    'H2',
    'M1',
    'M2',
    'R1',
    'R2',
    ...DEFAULT_GRAPHICS_KEYS
]);
export const RESERVED_ELEMENTS = new Set(SPECIAL_ELEMENT_KEYS[Symbol.iterator]().filter(x => x !== 'boss' && x !== 'enemy' && x !== 'arena'));
export const KEY_REGEX = /([^#]+)(?:#(?:(?:(\d+)\.\.(\d+))|(.+)))?/;
export const SUBKEY_REGEX = /\[([^[\]]+)\]/g;
export const RANGE_REGEX = /(?:(\d+)\.\.(\d+))/;

export interface KeyResolverResult {
    definition?: string;
    elements: string[];
    wildcard: boolean;
}

export function resolveKey(key: string, elements: Set<string>): KeyResolverResult {
    if (SPECIAL_ELEMENT_KEYS.has(key)) {
        return { definition: key, elements: unwrapSpecialKey(key), wildcard: false };
    }

    const match = KEY_REGEX.exec(key);

    if (match == null || match.index !== 0 || match[0].length !== key.length) {
        throw new Error(`"${key}" is not a valid diagram key.`);
    }

    const [_, elementKey, rangeStart, rangeEnd, subkey] = match as unknown as [string, string, string | undefined, string | undefined, string | undefined];
    const result: KeyResolverResult = { definition: elementKey, elements: [], wildcard: false };

    if (rangeStart != null && rangeEnd != null) {
        for (const i of parseRangeExpression(rangeStart, rangeEnd)) {
            result.elements.push(`${elementKey}#${i}`);
        }
    } else if (subkey != null) {
        const wildcardElements = accumulateWildcardElements(subkey, elementKey, elements);

        if (wildcardElements != null) {
            result.wildcard = true;
            result.elements.push(...wildcardElements);
        } else {
            result.elements.push(...accumulateBrackets(subkey, elementKey));
        }
    } else {
        if (key[0] === '[' && key[key.length - 1] === ']') {
            key = key.slice(1, -1);
            result.definition = undefined;
        }

        const values = key.split(',');

        for (const value of values) {
            result.elements.push(value.trim());
        }
    }

    return result;
}

function unwrapSpecialKey(key: string): string[] {
    switch (key) {
        case 'players': return ['T1', 'T2', 'H1', 'H2', 'M1', 'M2', 'R1', 'R2'];
        case 'DPS': return ['M1', 'M2', 'R1', 'R2'];
        case 'tanks': return ['T1', 'T2'];
        case 'healers': return ['H1', 'H2'];
        case 'supports': return ['T1', 'T2', 'H1', 'H2'];
        default: return [key];
    }
}

function* parseRangeExpression(from: string, to: string): Generator<number> {
    const rangeStart = Number.parseInt(from);
    const rangeEnd = Number.parseInt(to);

    if (rangeStart >= rangeEnd) {
        throw new Error(`Invalid range ${from}..${to}: end must be greater than start.`);
    }

    for (let i: number = rangeStart; i <= rangeEnd; i++) {
        yield i;
    }
}

function accumulateWildcardElements(subkey: string, elementKey: string, elements: Set<string>): string[] | null {
    const wildcardIndex = subkey.indexOf('*');

    if (wildcardIndex !== -1) {
        // Wildcard pattern match
        const leftKey = `${elementKey}#${subkey.slice(0, wildcardIndex)}`;
        const rightKey = subkey.slice(wildcardIndex + 1);
        const foundElements: string[] = [];

        for (const innerElementKey in elements) {
            if (innerElementKey.startsWith(leftKey) && innerElementKey.endsWith(rightKey)) {
                foundElements.push(innerElementKey);
            }
        }

        return foundElements;
    }

    return null;
}

function* accumulateBrackets(subkey: string, elementKey: string): Generator<string> {
    let strings: string[] = [elementKey + '#'];
    let lastIndex = 0;

    for (const match of subkey.matchAll(SUBKEY_REGEX)) {
        const prefix = subkey.slice(lastIndex, match.index);
        const rangeMatch = RANGE_REGEX.exec(match[1]!);

        if (rangeMatch != null) {
            const numbers = Array.from(parseRangeExpression(rangeMatch[1]!, rangeMatch[2]!));
            strings = strings.flatMap(string => numbers.map(element => string + prefix + element));
        } else {
            const split = match[1]!.split(',');

            if (split.length === 0) {
                throw new Error(`Bracket expression [] is missing contents: ${match[0]}`);
            }

            strings = strings.flatMap(string => split.map(element => string + prefix + element.trim()));
        }

        lastIndex = match.index! + match[0].length;
    }

    const suffix = subkey.slice(lastIndex);

    for (let j: number = 0; j < strings.length; j++) {
        strings[j] += suffix;

        yield strings[j];
    }
}
