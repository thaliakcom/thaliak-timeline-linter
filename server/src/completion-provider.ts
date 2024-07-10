import { CompletionItem, CompletionItemKind, CompletionParams, TextDocuments } from 'vscode-languageserver';
import { ParserCache } from './parser-cache';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';

const ICONS = ['tank', 'healer', 'dps', 'melee', 'ranged', 'pranged', 'caster', 'circle', 'cross', 'square', 'triangle'] as const;

export default function completionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: CompletionParams) => CompletionItem[] {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const initializer = textDocument.getText({ start: { line: params.position.line, character: params.position.character - 1 }, end: params.position });
        const previousCharacter = textDocument.getText({ start: { line: params.position.line, character: params.position.character - 2 }, end: { line: params.position.line, character: params.position.character - 1 } });

        const raidData = (documentCache.get(textDocument)?.toJS() as UnprocessedRaidData | undefined);
        const actions = raidData?.actions;

        if ((initializer === ':' || initializer === ' ') && textDocument.getText({ start: { line: params.position.line, character: 0 }, end: params.position }).includes('id:')) {
            if (actions != null && typeof actions === 'object') {
                const items: CompletionItem[] = [];

                for (const key in actions) {
                    const action = actions[key];

                    items.push({
                        label: key,
                        labelDetails: { description: action.description },
                        kind: CompletionItemKind.EnumMember
                    } satisfies CompletionItem);
                }

                return items;
            }
        }

        if (initializer === ':') {
            return [{
                label: 'unverified',
                labelDetails: { description: 'Unverified information' },
                kind: CompletionItemKind.Keyword,
                insertText: 'unverified()'
            }];
        }
        
        if (initializer !== '(' && initializer !== '[') {
            return [];
        }
    
        const items: CompletionItem[] = [];

        if (initializer === '(' && previousCharacter !== ']') {
            return items;
        }
    
        if (initializer === '[') {
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
                },
                ...ICONS.map(x => ({
                    label: `i:${x}`,
                    labelDetails: { description: 'icon' },
                    kind: CompletionItemKind.EnumMember
                }))
            );
        }
    
        const status = raidData?.status;
    
        const base = {
            kind: CompletionItemKind.EnumMember,
            commitCharacters: [initializer === '[' ? ']' : ')']
        };
    
        if (actions != null && typeof actions === 'object') {
            for (const key in actions) {
                const action = actions[key];
    
                items.push({
                    label: `a:${key}`,
                    labelDetails: { description: action.description },
                    sortText: `a1:${key}`,
                    ...base
                } satisfies CompletionItem);
            }
        }
    
        if (status != null && typeof status === 'object') {
            for (const key in status) {
                const item = status[key];

                items.push({
                    label: `s:${key}`,
                    labelDetails: { description: item.description },
                    sortText: `s1:${key}`,
                    ...base
                } satisfies CompletionItem);
            }
        }

        const enums = documentCache.getLinterOptions(settings).enums;

        if (enums.common != null) {
            for (const key in enums.common.yaml.actions) {
                items.push({
                    label: `a:${key}`,
                    labelDetails: { description: 'from enums/common.yaml' },
                    sortText: `a2:${key}`,
                    ...base
                });
            }

            for (const key in enums.common.yaml.status) {
                items.push({
                    label: `s:${key}`,
                    labelDetails: { description: 'from enums/common.yaml' },
                    sortText: `s2:${key}`,
                    ...base
                });
            }
        }

        if (enums.terms != null) {
            for (const key in enums.terms.yaml) {
                items.push({
                    label: `t:${key}`,
                    labelDetails: { description: enums.terms.yaml[key] },
                    ...base
                });
            }
        }

        if (enums['mechanic-types'] != null) {
            for (const key in enums['mechanic-types'].yaml) {
                items.push({
                    label: `m:${key}`,
                    labelDetails: { description: enums['mechanic-types'].yaml[key].description },
                    ...base
                });
            }
        }

        if (enums['mechanic-shapes'] != null) {
            for (const key in enums['mechanic-shapes'].yaml) {
                items.push({
                    label: `ms:${key}`,
                    labelDetails: { description: enums['mechanic-shapes'].yaml[key].description },
                    ...base
                });
            }
        }

        if (enums['status-types'] != null) {
            for (const key in enums['status-types'].yaml) {
                items.push({
                    label: `st:${key}`,
                    labelDetails: { description: enums['status-types'].yaml[key].description },
                    ...base
                });
            }
        }

        return items;
    };
}
