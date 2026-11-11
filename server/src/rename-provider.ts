import { PrepareRenameParams, Range, RenameParams, TextDocumentPositionParams, TextDocuments, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { definitionOccurrencesOf, diagramOf, occurrencesOf } from './diagram-context';
import { findPlaceholders, getActor, getActorValues, getArenaAt, getArenaValues, getIfType, getRange, getStatusValues, getSymbolAt, SymbolRange } from './util';
import * as yaml from 'yaml';

export function renameProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: RenameParams) => WorkspaceEdit | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri);
        const document = documentCache.get(params.textDocument);
        
        if (textDocument == null || document == null) {
            return null;
        }

        const symbol = getRenameableSymbol(documents, documentCache, settings, params);

        if (symbol == null) {
            return null;
        }

        return timelineRenameEdit(documents, textDocument, document, symbol.text, params.newName);
    };
}

/**
 * The edits that rename `symbol` of the timeline `textDocument` (`a:<action>`, `s:<status>`, `ac:<actor>` or
 * `ar:<arena>`) to `newName`, in the timeline and in its `.diagram` file. `null` if the timeline doesn't name it.
 */
export function timelineRenameEdit(documents: TextDocuments<TextDocument>, textDocument: TextDocument, document: yaml.Document, symbol: string, newName: string): WorkspaceEdit | null {
    const edits: TextEdit[] = [];
    const edit: WorkspaceEdit = {
        changes: {
            [textDocument.uri]: edits
        }
    };

    if (symbol.startsWith('a:')) {
        const actionId = symbol.slice(2);
        const actions = getIfType(document, 'actions', yaml.isMap);
        const timeline = getIfType(document, 'timeline', yaml.isSeq);

        if (actions != null) {
            for (const action of actions.items) {
                if (yaml.isScalar(action.key) && action.key.range != null && action.key.value === actionId) {
                    edits.push(TextEdit.replace(getRange(textDocument, action.key.range), newName));
                }

                const children = yaml.isMap(action.value) ? getIfType(action.value, 'children', yaml.isSeq) : null;

                if (children != null) {
                    for (const child of children.items) {
                        if (yaml.isMap(child)) {
                            const id = getIfType(child, 'id', yaml.isScalar);

                            if (id != null && id.value === actionId && id.range != null) {
                                edits.push(TextEdit.replace(getRange(textDocument, id.range), newName));
                            }
                        }
                    }
                }
            }
        }

        if (timeline != null) {
            for (const item of timeline.items) {
                if (yaml.isMap(item)) {
                    const id = getIfType(item, 'id', yaml.isScalar);

                    if (id != null && id.value === actionId && id.range != null) {
                        edits.push(TextEdit.replace(getRange(textDocument, id.range), newName));
                    }
                }
            }
        }

        for (const placeholder of findPlaceholders(textDocument, symbol)) {
            edits.push(TextEdit.replace(placeholder, `a:${newName}`));
        }
    } else if (symbol.startsWith('s:')) {
        const actionId = symbol.slice(2);
        const status = getIfType(document, 'status', yaml.isMap);

        if (status != null) {
            for (const effect of status.items) {
                if (yaml.isScalar(effect.key) && effect.key.range != null && effect.key.value === actionId) {
                    edits.push(TextEdit.replace(getRange(textDocument, effect.key.range), newName));
                }
            }
        }

        for (const value of getStatusValues(document)) {
            if (value.key === actionId) {
                edits.push(TextEdit.replace(getRange(textDocument, value.range), newName));
            }
        }

        for (const placeholder of findPlaceholders(textDocument, symbol)) {
            edits.push(TextEdit.replace(placeholder, `s:${newName}`));
        }
    } else if (symbol.startsWith('ac:')) {
        const key = symbol.slice(3);
        const actor = getActor(document, key);

        if (actor?.key.range != null) {
            edits.push(TextEdit.replace(getRange(textDocument, actor.key.range), newName));
        }

        for (const value of getActorValues(document)) {
            if (value.key === key) {
                edits.push(TextEdit.replace(getRange(textDocument, value.range), newName));
            }
        }
    } else if (symbol.startsWith('ar:')) {
        const id = symbol.slice(3);

        for (const value of getArenaValues(document)) {
            if (value.key === id) {
                edits.push(TextEdit.replace(getRange(textDocument, value.range), newName));
            }
        }
    }

    const diagram = diagramOf(documents, textDocument.uri);

    if (diagram != null) {
        const key = symbol.slice(symbol.indexOf(':') + 1);
        const kind = symbol.startsWith('a:') ? 'action' : symbol.startsWith('ac:') ? 'actor' : 'status';
        const ranges = symbol.startsWith('ar:') ? definitionOccurrencesOf(diagram, 'arena', key) : occurrencesOf(diagram, kind, key);
        const diagramEdits = ranges.map(range => TextEdit.replace(range, newName));

        if (diagramEdits.length > 0) {
            edit.changes![diagram.uri] = diagramEdits;
        }
    }

    return edits.length > 0 ? edit : null;
}

function getRenameableSymbol(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings, params: TextDocumentPositionParams): SymbolRange | null {
        const textDocument = documents.get(params.textDocument.uri);
        const document = documentCache.get(params.textDocument);
        
        if (textDocument == null || document == null) {
            return null;
        }

        const symbol = getSymbolAt(document, textDocument, params.position) ?? getArenaAt(document, textDocument, params.position);

        if (symbol == null) {
            return null;
        }

        if (symbol.text.startsWith('a:') || symbol.text.startsWith('s:') || symbol.text.startsWith('ac:') || symbol.text.startsWith('ar:')) {
            return symbol;
        }

        return null;
}

export function prepareRenameProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: PrepareRenameParams) => Range | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri);
        const renameableSymbol = getRenameableSymbol(documents, documentCache, settings, params);

        if (renameableSymbol == null || textDocument == null) {
            return null;
        }

        const text = textDocument.getText(renameableSymbol.range);

        if (text.startsWith('a:') || text.startsWith('s:')) {
            renameableSymbol.range.start.character += 2;
        }

        const newText = textDocument.getText(renameableSymbol.range);
        const lastColon = newText.lastIndexOf(':');

        if (lastColon !== -1) {
            renameableSymbol.range.end.character -= newText.length - lastColon;
        }

        return renameableSymbol.range;
    };
}
