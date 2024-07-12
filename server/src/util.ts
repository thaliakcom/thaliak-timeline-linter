import { Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';

export const PLACEHOLDER_REGEX = /(?:(?:\(((?:a|s|m|ms|st|t|i):[A-z0-9\-_()]+)\))|(?:\[((?:a|s|m|ms|st|t|i):[A-z0-9\-_()]+?)(?:(?::c)|(?::d))?\]))/g;
export const KEY_REGEX = /^\s{2}([^\s]*):\s/g;

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
        console.log(`[symbol-resolver]: parsed key (${rawKey}) contains brackets; aborting`);
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

export function getSymbolAt(textDocument: TextDocument, position: Position): TextRange | null {
    const placeholder = getPlaceholderAt(textDocument, position);

    if (placeholder != null) {
        console.log(`[symbol-resolver]: found placeholder '${placeholder.text}' at cursor position`);
        return placeholder;
    }

    const id = getKeyValueAt(textDocument, position, 'id');

    if (id != null) {
        console.log(`[symbol-resolver]: found action '${id.text}' at cursor position`);
        id.text = `a:${id.text}`;
        return id;
    }

    const mechanic = getKeyValueAt(textDocument, position, 'mechanic');

    if (mechanic != null) {
        console.log(`[symbol-resolver]: found mechanic '${mechanic.text}' at cursor position`);
        mechanic.text = `m:${mechanic.text}`;
        return mechanic;
    }

    const shape = getKeyValueAt(textDocument, position, 'shape');

    if (shape != null) {
        console.log(`[symbol-resolver]: found shape '${shape.text}' at cursor position`);
        shape.text = `ms:${shape.text}`;
        return shape;
    }

    const statusType = getKeyValueAt(textDocument, position, 'type');

    if (statusType != null) {
        console.log(`[symbol-resolver]: found status type '${statusType.text}' at cursor position`);
        statusType.text = `st:${statusType.text}`;
        return statusType;
    }

    console.log(`[symbol-resolver]: no symbol found at cursor position`);

    return null;
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
