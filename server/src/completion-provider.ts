import { CompletionItem, CompletionItemKind, CompletionParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';
import { getSymbolAt, ICONS, perPrefix, SPECIAL_TIMELINE_IDS } from './util';

export default function completionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: CompletionParams) => CompletionItem[] {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const document = documentCache.get(textDocument);

        if (document == null) {
            return [];
        }

        const raidData = document.toJS() as UnprocessedRaidData;
        const symbol = getSymbolAt(document, textDocument, params.position, true);
        const actions = raidData?.actions;
        const accumulatedActions: Set<string> = new Set();
        const accumulatedStatuses: Set<string> = new Set();

        if (symbol == null) {
            const lineBefore = textDocument.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
            const colonIndex = lineBefore.indexOf(':');

            if (colonIndex !== -1 && !lineBefore.slice(colonIndex, params.position.character).includes(' ')) {
                return [{
                    label: 'unverified',
                    labelDetails: { description: 'Unverified information' },
                    kind: CompletionItemKind.Keyword,
                    insertText: 'unverified()'
                }];
            }

            return [];
        }

        let accumulateActions = false;
        let accumulateStatus = false;
        let accumulateTerms = false;
        let accumulateMechanicTypes = false;
        let accumulateMechanicShapes = false;
        let accumulateStatusTypes = false;
        let accumulateDamageTypes = false;
        let accumulateIcons = false;
        let accumulateSpecials = false;

        perPrefix(symbol.text, {
            'a:': () => { accumulateActions = true; },
            's:': () => { accumulateStatus = true; },
            't:': () => { accumulateTerms = true; },
            'm:': () => { accumulateMechanicTypes = true; },
            'ms:': () => { accumulateMechanicShapes = true; },
            'st:': () => { accumulateStatusTypes = true; },
            'dt:': () => { accumulateDamageTypes = true; },
            'i:': () => { accumulateIcons = true; },
            else: () => {
                accumulateActions = true;
                accumulateStatus = true;
                accumulateTerms = true;
                accumulateMechanicTypes = true;
                accumulateMechanicShapes = true;
                accumulateStatusTypes = true;
                accumulateDamageTypes = true;
                accumulateIcons = true;
                accumulateSpecials = symbol.delimiter === 'square';
            }
        });
    
        const base = {
            kind: CompletionItemKind.EnumMember
        };
    
        const items: CompletionItem[] = [];

        if (accumulateActions && actions != null && typeof actions === 'object') {
            for (const key in actions) {
                const action = actions[key];

                items.push({
                    label: symbol.delimiter != null ? `a:${key}` : key,
                    labelDetails: { description: action.description },
                    sortText: `a1:${key}`,
                    ...base
                });

                accumulatedActions.add(key);
            }

            if (symbol.delimiter == null) {
                for (const item of SPECIAL_TIMELINE_IDS) {
                    items.push({
                        label: item.id,
                        labelDetails: { description: item.description },
                        sortText: 'zzzz' + item.id,
                        ...base
                    });
                }
            }
        }
    
        if (accumulateSpecials) {
            items.push(
                {
                    label: 'fight',
                    labelDetails: { description: 'Name of the fight' },
                    kind: CompletionItemKind.Reference,
                    commitCharacters: [']']
                },
                {
                    label: 'boss',
                    labelDetails: { description: 'Name of the boss' },
                    kind: CompletionItemKind.Reference,
                    commitCharacters: [']']
                }
            );
        }

        if (accumulateIcons) {
            items.push(...ICONS.map(x => ({
                label: `i:${x}`,
                labelDetails: { description: 'icon' },
                kind: CompletionItemKind.EnumMember
            })));
        }
    
        const status = raidData?.status;
    
        if (accumulateStatus && status != null && typeof status === 'object') {
            for (const key in status) {
                const item = status[key];

                items.push({
                    label: symbol.delimiter != null ? `s:${key}` : key,
                    labelDetails: { description: item.description },
                    sortText: `s1:${key}`,
                    ...base
                });

                accumulatedStatuses.add(key);
            }
        }

        const enums = documentCache.getLinterOptions(settings).enums;

        if (enums.common != null && symbol.delimiter != null) {
            if (accumulateActions) {
                for (const key in enums.common.yaml.actions) {
                    if (!accumulatedActions.has(key)) {
                        items.push({
                            label: symbol.delimiter != null ? `a:${key}` : key,
                            labelDetails: { description: 'common action' },
                            sortText: `a2:${key}`,
                            ...base
                        });
                    }
                }
            }

            if (accumulateStatus) {
                for (const key in enums.common.yaml.status) {
                    if (!accumulatedStatuses.has(key)) {
                        items.push({
                            label: symbol.delimiter != null ? `s:${key}` : key,
                            labelDetails: { description: 'common status' },
                            sortText: `s2:${key}`,
                            ...base
                        });
                    }
                }
            }
        }

        if (enums.terms != null && accumulateTerms) {
            for (const key in enums.terms.yaml) {
                items.push({
                    label: symbol.delimiter != null ? `t:${key}` : key,
                    labelDetails: { description: enums.terms.yaml[key] },
                    ...base
                });
            }
        }

        if (enums['mechanic-types'] != null && accumulateMechanicTypes) {
            for (const key in enums['mechanic-types'].yaml) {
                items.push({
                    label: symbol.delimiter != null ? `m:${key}` : key,
                    labelDetails: { description: enums['mechanic-types'].yaml[key].description },
                    ...base
                });
            }
        }

        if (enums['mechanic-shapes'] != null && accumulateMechanicShapes) {
            for (const key in enums['mechanic-shapes'].yaml) {
                items.push({
                    label: symbol.delimiter != null ? `ms:${key}` : key,
                    labelDetails: { description: enums['mechanic-shapes'].yaml[key].description },
                    ...base
                });
            }
        }

        if (enums['status-types'] != null && accumulateStatusTypes) {
            for (const key in enums['status-types'].yaml) {
                items.push({
                    label: symbol.delimiter != null ? `st:${key}` : key,
                    labelDetails: { description: enums['status-types'].yaml[key].description },
                    ...base
                });
            }
        }

        if (enums['damage-types'] != null && accumulateDamageTypes) {
            for (const key in enums['damage-types'].yaml) {
                items.push({
                    label: symbol.delimiter != null ? `dt:${key}` : key,
                    labelDetails: { description: enums['damage-types'].yaml[key].description },
                    ...base
                });
            }
        }

        return items;
    };
}
