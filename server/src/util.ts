import { Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';

export const PLACEHOLDER_REGEX = /(?:\[[^[\]\n]+\](?:\(((?:a|s|m|ms|st|dt|t|i):[^()\n]+)\))|(?:\[((?:a|s|m|ms|st|dt|t|i):[^[\]\n]+?)(?:(?::c)|(?::d))?\]))/g;
export const KEY_REGEX = /^\s{2}([^\s]*):\s/g;

export const ICONS = ['tank', 'healer', 'dps', 'melee', 'ranged', 'pranged', 'caster', 'circle', 'cross', 'square', 'triangle'] as const;

export const SPECIAL_TIMELINE_IDS: Array<{ id: string, description: string }> = [
    { id: '<untargetable>', description: 'Indicates that the enemy or enemies on the field become untargetable. Should be followed by a <targetable> item.' },
    { id: '<targetable>', description: 'Indicates that the enemy or enemies on the field become targetable (again). Must be preceded by an <untargetable> item.' },
    { id: '<phase>', description: 'Indicates that a new phase of the fight begins.' },
    { id: '<addstatus>', description: 'Indicates that status effects are inflicted on players. Only use this kind of item if the statuses are not inflicted by an enemy action.' },
    { id: '<removestatus>', description: 'Indicates that status effects fall off from players. Only use this kind of item if the statuses do not have a fixed duration and instead fall off as a result of some other condition. Do not use this kind of item if the status is consumed by some other enemy action.' },
    { id: '<loop>', description: 'Indicates that all mechanics or a subset of mechanics up until now will loop until the boss enrages or a specific condition is met.' }
];

export interface TextRange {
    text: string;
    range: Range;
}

export interface PlaceholderRange extends TextRange {
    delimiter: 'square' | 'round';
}

export function getPlaceholderAt(textDocument: TextDocument, position: Position, allowIncomplete: boolean = false): PlaceholderRange | null {
    const lineBefore = textDocument.getText({ start: { line: position.line, character: 0 }, end: position });
    const lineAfter = textDocument.getText({ start: position, end: { line: position.line, character: Infinity } });

    let startSymbol = '[';
    let startIndex = lineBefore.lastIndexOf(startSymbol);
    let endSymbol = ']';

    const startIndexCircular = lineBefore.lastIndexOf('(');

    if (startIndexCircular > startIndex) {
        startIndex = startIndexCircular;
        startSymbol = '(';
        endSymbol = ')';
    }

    let endIndex = lineAfter.indexOf(endSymbol);

    if (endIndex === -1 && allowIncomplete) {
        endSymbol = ' ';
        endIndex = lineAfter.indexOf(endSymbol);
    }

    if (startIndex === -1 || endIndex === -1) {
        return null;
    }

    if (startSymbol === '(' && lineBefore[startIndex - 1] !== ']') {
        return null;
    }

    const keyBefore = lineBefore.slice(startIndex + 1);
    const keyAfter = lineAfter.slice(0, endIndex);
    const rawKey = keyBefore + keyAfter;
    const key = rawKey.replace(':c]', ']').replace(':d]', ']');

    if (rawKey.includes(startSymbol) || rawKey.includes(endSymbol)) {
        console.log(`[symbol-resolver]: parsed key (${rawKey}) contains '${startSymbol}' or '${endSymbol}'; aborting`);
        return null;
    }

    return {
        text: key,
        range: {
            start: { line: position.line, character: position.character - keyBefore.length },
            end: { line: position.line, character: position.character + keyAfter.length }
        },
        delimiter: startSymbol === '[' ? 'square' : 'round'
    };
}

export function getKeyValueAt(textDocument: TextDocument, position: Position, key: string): TextRange | null {
    const lineBefore = textDocument.getText({ start: { line: position.line, character: 0 }, end: position });
    const lineAfter = textDocument.getText({ start: position, end: { line: position.line, character: Infinity } });

    const trimmedLineBefore = lineBefore.trimStart();

    // We don't want to match if the key is at the top level of the document
    // to avoid false positives.
    if (trimmedLineBefore === lineBefore || !trimmedLineBefore.startsWith(`${key}: `)) {
        return null;
    }

    const startIndex = lineBefore.indexOf(key) + key.length + 2;
    let endIndex = lineAfter.lastIndexOf('\n');

    if (endIndex !== -1) {
        endIndex += lineBefore.length;
    } else {
        endIndex = Infinity;
    }

    const keyBefore = lineBefore.slice(startIndex);
    const keyAfter = lineAfter.slice(0, endIndex - lineBefore.length);
    const rawKey = keyBefore + keyAfter;

    return {
        text: rawKey,
        range: {
            start: { line: position.line, character: startIndex },
            end: { line: position.line, character: endIndex }
        }
    };
}

function isInRange(textDocument: TextDocument, textRange: Range, yamlRange: yaml.Range): boolean {
    const start = textDocument.offsetAt(textRange.start);
    const end = textDocument.offsetAt(textRange.end);

    return start >= yamlRange[0] && end <= yamlRange[2];
}

type GuardedType<T> = T extends (node: unknown) => node is infer U ? U : never;

export function getIfType<T extends (node: unknown) => boolean>(node: yaml.YAMLMap | yaml.Document, key: string, typeFn: T): GuardedType<T> | null {
    const item = node.get(key, true);

    if (typeFn(item)) {
        return item as GuardedType<T>;
    }

    return null;
}

type SymbolRange = TextRange & Partial<PlaceholderRange>;

export function getSymbolAt(document: yaml.Document, textDocument: TextDocument, position: Position, allowIncomplete: boolean = false): SymbolRange | null {
    const placeholder = getPlaceholderAt(textDocument, position, allowIncomplete);

    if (placeholder != null) {
        console.log(`[symbol-resolver]: found placeholder '${placeholder.text}' at cursor position`);
        return placeholder;
    }

    const status = getIfType(document, 'status', yaml.isMap);
    const actions = getIfType(document, 'actions', yaml.isMap);
    const timeline = getIfType(document, 'timeline', yaml.isSeq);

    const id = getKeyValueAt(textDocument, position, 'id');

    if (id != null) {
        if (timeline != null && isInRange(textDocument, id.range, timeline.range!)) {
            console.log(`[symbol-resolver]: found timeline action '${id.text}' at cursor position`);
            id.text = `a:${id.text}`;
            return id;
        }

        if (actions != null) {
            for (const action of actions.items) {
                if (yaml.isMap(action.value)) {
                    const children = getIfType(action.value, 'children', yaml.isSeq);

                    if (children != null && isInRange(textDocument, id.range, children.range!)) {
                        console.log(`[symbol-resolver]: found child action '${id.text}' at cursor position`);
                        id.text = `a:${id.text}`;
                        return id;
                    }
                }
            }
        }
        
        return null;
    }

    const mechanic = getKeyValueAt(textDocument, position, 'mechanic');

    if (mechanic != null) {
        if (actions != null && isInRange(textDocument, mechanic.range, actions.range!)) {
            console.log(`[symbol-resolver]: found mechanic '${mechanic.text}' at cursor position`);
            mechanic.text = `m:${mechanic.text}`;
            return mechanic;
        }

        return null;
    }

    const shape = getKeyValueAt(textDocument, position, 'shape');

    if (shape != null) {
        if (actions != null && isInRange(textDocument, shape.range, actions.range!)) {
            console.log(`[symbol-resolver]: found shape '${shape.text}' at cursor position`);
            shape.text = `ms:${shape.text}`;
            return shape;
        }

        return null;
    }

    const _type = getKeyValueAt(textDocument, position, 'type');

    if (_type != null) {
        if (status != null && isInRange(textDocument, _type.range, status.range!)) {
            console.log(`[symbol-resolver]: found status type '${_type.text}' at cursor position`);
            _type.text = `st:${_type.text}`;
            return _type;
        }

        if (actions != null && isInRange(textDocument, _type.range, actions.range!)) {
            console.log(`[symbol-resolver]: found damage type '${_type.text}' at cursor position`);
            _type.text = `dt:${_type.text}`;
            return _type;
        }

        return null;
    }

    console.log(`[symbol-resolver]: no symbol found at cursor position`);

    return null;
}

export function getRange(textDocument: TextDocument, range: yaml.Range): Range {
    return getRangeFromOffset(textDocument, range[0], range[1]);
}

export function getRangeFromOffset(textDocument: TextDocument, start: number, end: number): Range {
    return { start: textDocument.positionAt(start), end: textDocument.positionAt(end) };
}

export function getRangeAt(textDocument: TextDocument, offset: number, linePos?: 'start' | 'end'): Range {
    const position = textDocument.positionAt(offset);

    if (linePos === 'start') {
        position.character = 0;
    } else if (linePos === 'end') {
        position.character = 99999;
    }

    return { start: position, end: position };
}

export function getEntry(map: yaml.YAMLMap, key: string): yaml.Pair<yaml.Scalar<string>, yaml.Node<unknown>> | undefined {
    return map.items.find(x => yaml.isScalar(x.key) && x.key.value === key) as yaml.Pair<yaml.Scalar<string>, yaml.Node<unknown>>;
}

export function getAction(document: yaml.Document | undefined, key: string): yaml.Pair<yaml.Scalar<string>, yaml.Node<unknown>> | null {
    const actions = document?.get('actions');

    if (actions != null && yaml.isMap(actions)) {
        const action = getEntry(actions, key);

        if (action != null) {
            return action as yaml.Pair<yaml.Scalar<string>, yaml.Node<unknown>>;
        }
    }

    return null;
}

export function getStatus(document: yaml.Document | undefined, key: string): yaml.Pair<yaml.Scalar<string>, yaml.Node<unknown>> | null {
    const statusEffects = document?.get('status');

    if (statusEffects != null && yaml.isMap(statusEffects)) {
        const status = getEntry(statusEffects, key);

        if (status != null) {
            return status as yaml.Pair<yaml.Scalar<string>, yaml.Node<unknown>>;
        }
    }

    return null;
}

interface Prefixes<T> {
    'a:'?: (key: string) => T;
    's:'?: (key: string) => T;
    'm:'?: (key: string) => T;
    'ms:'?: (key: string) => T;
    'st:'?: (key: string) => T;
    'dt:'?: (key: string) => T;
    't:'?: (key: string) => T;
    'i:'?: (key: string) => T;
    else?: (key: string) => T;
}

export function perPrefix<T>(key: string, prefixes: Prefixes<T>): T | null {
    for (const prefix in prefixes) {
        if (key.startsWith(prefix)) {
            // @ts-expect-error TS failure to infer
            return prefixes[prefix](key.slice(prefix.length));
        }
    }

    return prefixes.else?.(key) ?? null;
}
