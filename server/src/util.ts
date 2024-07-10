import { Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';

export const PLACEHOLDER_REGEX = /(?:(?:\(((?:a|s|m|ms|st|t|i):[A-z0-9\-_()]+)\))|(?:\[((?:a|s|m|ms|st|t|i):[A-z0-9\-_()]+?)(?:(?::c)|(?::d))?\]))/g;
export const KEY_REGEX = /^\s{2}([^\s]*):\s/g;
export const ID_REGEX = /^\s+id:\s(.*)/g;

export const ICONS = ['tank', 'healer', 'dps', 'melee', 'ranged', 'pranged', 'caster', 'circle', 'cross', 'square', 'triangle'] as const;

export interface TextRange {
    text: string;
    range: Range;
}

export function getPlaceholderAt(textDocument: TextDocument, position: Position): TextRange | null {
    const lineBefore = textDocument.getText({ start: { line: position.line, character: 0 }, end: position });
    const lineAfter = textDocument.getText({ start: position, end: { line: position.line, character: Infinity } });

    let startIndex = lineBefore.lastIndexOf('[');
    let brackets = true;

    const startIndexCircular = lineBefore.lastIndexOf('(');

    if (startIndexCircular > startIndex) {
        startIndex = startIndexCircular;
        brackets = false;
    }

    const endSymbol = brackets ? ']' : ')';
    const endIndex = lineAfter.indexOf(endSymbol);

    if (startIndex === -1 || endIndex === -1) {
        return null;
    }

    const keyBefore = lineBefore.slice(startIndex + 1);
    const keyAfter = lineAfter.slice(0, endIndex);
    const rawKey = keyBefore + keyAfter;
    const key = rawKey.replace(':c]', ']').replace(':d]', ']');

    if (rawKey.includes(brackets ? '[' : '(') || rawKey.includes(endSymbol)) {
        return null;
    }

    return {
        text: key,
        range: {
            start: { line: position.line, character: position.character - keyBefore.length },
            end: { line: position.line, character: position.character + keyAfter.length }
        }
    };
}

export function getRange(textDocument: TextDocument, range: yaml.Range): Range {
    return { start: textDocument.positionAt(range[0]), end: textDocument.positionAt(range[1]) };
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
    't:'?: (key: string) => T;
    'i:'?: (key: string) => T;
}

export function perPrefix<T>(key: string, prefixes: Prefixes<T>): T | null {
    for (const prefix in prefixes) {
        if (key.startsWith(prefix)) {
            // @ts-expect-error TS failure to infer
            return prefixes[prefix](key.slice(prefix.length));
        }
    }

    return null;
}
