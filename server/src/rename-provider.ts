import { PrepareRenameParams, Range, RenameParams, TextDocumentPositionParams, TextDocuments, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { findPlaceholders, getIfType, getRange, getSymbolAt, SymbolRange } from './util';
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

        const edits: TextEdit[] = [];
        const edit: WorkspaceEdit = {
            changes: {
                [params.textDocument.uri]: edits
            }
        };

        if (symbol.text.startsWith('a:')) {
            const actionId = symbol.text.slice(2);
            const actions = getIfType(document, 'actions', yaml.isMap);
            const timeline = getIfType(document, 'timeline', yaml.isSeq);

            if (actions != null) {
                for (const action of actions.items) {
                    if (yaml.isScalar(action.key) && action.key.range != null && action.key.value === actionId) {
                        edits.push(TextEdit.replace(getRange(textDocument, action.key.range), params.newName));
                    }

                    const children = yaml.isMap(action.value) ? getIfType(action.value, 'children', yaml.isSeq) : null;

                    if (children != null) {
                        for (const child of children.items) {
                            if (yaml.isMap(child)) {
                                const id = getIfType(child, 'id', yaml.isScalar);

                                if (id != null && id.value === actionId && id.range != null) {
                                    edits.push(TextEdit.replace(getRange(textDocument, id.range), params.newName));
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
                            edits.push(TextEdit.replace(getRange(textDocument, id.range), params.newName));
                        }
                    }
                }
            }

            for (const placeholder of findPlaceholders(textDocument, symbol.text)) {
                edits.push(TextEdit.replace(placeholder, `a:${params.newName}`));
            }
        } else if (symbol.text.startsWith('s:')) {
            const actionId = symbol.text.slice(2);
            const status = getIfType(document, 'status', yaml.isMap);

            if (status != null) {
                for (const effect of status.items) {
                    if (yaml.isScalar(effect.key) && effect.key.range != null && effect.key.value === actionId) {
                        edits.push(TextEdit.replace(getRange(textDocument, effect.key.range), params.newName));
                    }
                }
            }

            for (const placeholder of findPlaceholders(textDocument, symbol.text)) {
                edits.push(TextEdit.replace(placeholder, `s:${params.newName}`));
            }
        }

        return edits.length > 0 ? edit : null;
    };
}

function getRenameableSymbol(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings, params: TextDocumentPositionParams): SymbolRange | null {
        const textDocument = documents.get(params.textDocument.uri);
        const document = documentCache.get(params.textDocument);
        
        if (textDocument == null || document == null) {
            return null;
        }

        const symbol = getSymbolAt(document, textDocument, params.position);

        if (symbol == null) {
            return null;
        }

        if (symbol.text.startsWith('a:') || symbol.text.startsWith('s:')) {
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
