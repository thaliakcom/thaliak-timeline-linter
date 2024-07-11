import { Location, Position, ReferenceParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { getAction, getKeyValueAt, getRange, getStatus, getSymbolAt, KEY_REGEX, perPrefix, TextRange } from './util';

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

function getKeyAt(textDocument: TextDocument, position: Position): TextRange | null {
    const lineBefore = textDocument.getText({ start: { line: position.line, character: 0 }, end: position });
    const lineAfter = textDocument.getText({ start: position, end: { line: position.line, character: Infinity } });

    const match = KEY_REGEX.exec(lineBefore.concat(lineAfter));
    KEY_REGEX.lastIndex = 0;

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

export default function referenceProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: ReferenceParams) => Location[] | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const documentText = textDocument.getText();
        const document = documentCache.get(params.textDocument);

        if (document == null) {
            return null;
        }

        let key = getSymbolAt(textDocument, params.position);
        let textKey: string;

        if (key != null) {
            textKey = key.text;
        } else {
            key = getKeyAt(textDocument, params.position);

            if (key != null) {
                const actions = document?.get('actions');
                const status = document?.get('status');
                const offset = textDocument.offsetAt(key.range.start);

                if (actions != null && yaml.isMap(actions) && offset >= actions.range![0] && offset < actions.range![2] && actions.has(key.text)) {
                    textKey = `a:${key.text}`;
                } else if (status != null && yaml.isMap(status) && offset >= status.range![0] && offset < status.range![2] && status.has(key.text)) {
                    textKey = `s:${key.text}`;
                } else {
                    return null;
                }
            } else {
                key = getKeyValueAt(textDocument, params.position, 'id');

                if (key == null) {
                    return null;
                }

                textKey = `a:${key.text}`;
            }
        }

        const locations: Location[] = [];

        perPrefix(textKey, {
            'a:': key => {
                const action = getAction(document, key);
    
                if (action != null) {
                    locations.push(makeLocation(textDocument, action.key.range!));
                }
    
                const regex = new RegExp(`\\s*id:\\s(${escapeRegExp(key)})\\s`, 'g');
    
                for (const match of documentText.matchAll(regex)) {
                    const delta = match[0].length - match[1].length - 1;
                    locations.push(makeLocation(textDocument, [match.index! + delta, match.index! + match[1].length + delta, match.index! + match[1].length + delta]));
                }
            },
            's:': key => {
                const status = getStatus(document, key);
    
                if (status != null) {
                    locations.push(makeLocation(textDocument, status.key.range!));
                }
            }
        });

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
