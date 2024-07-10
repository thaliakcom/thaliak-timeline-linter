import { DefinitionLink, DefinitionParams, Hover, HoverParams, Location, Position, Range, ReferenceParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';
import { getAction, getPlaceholderAt, getRange, getStatus, TextRange } from './util';
import * as yaml from 'yaml';

const KEY_REGEX = /^\s{2}([^\s]*):\s/;
const ID_REGEX = /^\s*id:\s(.*)/;

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}


function getKeyAt(textDocument: TextDocument, position: Position): TextRange | null {
    const lineBefore = textDocument.getText({ start: { line: position.line, character: 0 }, end: position });
    const lineAfter = textDocument.getText({ start: position, end: { line: position.line, character: Infinity } });

    const match = lineBefore.concat(lineAfter).match(KEY_REGEX);

    if (match == null) {
        return null;
    }

    return { text: match[1], range: { start: { line: position.line, character: 2 }, end: { line: position.line, character: match[1].length + 2 } } };
}

function makeLocation(textDocument: TextDocument, range: yaml.Range): Location {
    return {
        uri: textDocument.uri,
        range: getRange(textDocument, range)
    };
}

function getIdAt(textDocument: TextDocument, position: Position): TextRange | null {
    const lineBefore = textDocument.getText({ start: { line: position.line, character: 0 }, end: position });
    const lineAfter = textDocument.getText({ start: position, end: { line: position.line, character: Infinity } });

    const match = lineBefore.concat(lineAfter).match(ID_REGEX);

    if (match == null) {
        return null;
    }

    const delta = match[0].length - match[1].length;

    return { text: match[1], range: { start: { line: position.line, character: delta }, end: { line: position.line, character: match[1].length + delta } } };
}

export default function referenceProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: ReferenceParams) => Location[] | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const documentText = textDocument.getText();
        const document = documentCache.get(params.textDocument);

        if (document == null) {
            return null;
        }

        let key = getPlaceholderAt(textDocument, params.position);
        let textKey: string;

        if (key != null) {
            textKey = key.text;
        } else {
            key = getKeyAt(textDocument, params.position);

            if (key != null) {
                const actions = document?.get('actions');
                const status = document?.get('status');
                const offset = textDocument.offsetAt(key.range.start);

                if (actions != null && yaml.isMap(actions) && offset > actions.range![0] && offset < actions.range![2] && actions.has(key.text)) {
                    textKey = `a:${key.text}`;
                } else if (status != null && yaml.isMap(status) && offset > status.range![0] && offset < status.range![2] && status.has(key.text)) {
                    textKey = `s:${key.text}`;
                } else {
                    return null;
                }
            } else {
                key = getIdAt(textDocument, params.position);

                if (key == null) {
                    return null;
                }

                textKey = `a:${key.text}`;
            }
        }

        const locations: Location[] = [];

        if (textKey.startsWith('a:')) {
            const innerKey = textKey.slice(2);
            const action = getAction(document, innerKey);

            if (action != null) {
                locations.push(makeLocation(textDocument, action.key.range!));
            }

            const regex = new RegExp(`\\s*id:\\s(${escapeRegExp(innerKey)})\\s`, 'g');

            for (const match of documentText.matchAll(regex)) {
                const delta = match[0].length - match[1].length - 1;
                locations.push(makeLocation(textDocument, [match.index! + delta, match.index! + match[1].length + delta, match.index! + match[1].length + delta]));
            }
        } else if (textKey.startsWith('s:')) {
            const innerKey = textKey.slice(2);
            const status = getStatus(document, innerKey);

            if (status != null) {
                locations.push(makeLocation(textDocument, status.key.range!));
            }
        }

        let index = -1;

        do {
            index = documentText.indexOf(textKey, index + 1);
            const nextCharacter = documentText[index + textKey.length];

            if (index !== -1 && (nextCharacter === ':' || nextCharacter === ']' || nextCharacter === ')')) {
                locations.push(makeLocation(textDocument, [index, index + textKey.length, index + textKey.length]));
            }
        } while (index > 0);

        return locations;
    };
}
