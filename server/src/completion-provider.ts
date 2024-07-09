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
    
        const items: CompletionItem[] = [];

        if (initializer === '(' && previousCharacter !== ']') {
            return items;
        }
    
        if (initializer === '[') {
            items.push(
                {
                    label: 'fight',
                    labelDetails: { description: 'Name of the fight.' },
                    kind: CompletionItemKind.Reference,
                    commitCharacters: [']']
                },
                {
                    label: 'boss',
                    labelDetails: { description: 'Name of the boss.' },
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
    
        const raidData = (documentCache.get(textDocument)?.toJS() as UnprocessedRaidData | undefined);
        const actions = raidData?.actions;
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

        if (enums != null) {
            for (const key in enums.common.actions) {
                items.push({
                    label: `a:${key}`,
                    labelDetails: { description: 'from enums/common.yaml' },
                    sortText: `a2:${key}`,
                    ...base
                });
            }

            for (const key in enums.common.status) {
                items.push({
                    label: `s:${key}`,
                    labelDetails: { description: 'from enums/common.yaml' },
                    sortText: `s2:${key}`,
                    ...base
                });
            }

            for (const key in enums.terms) {
                items.push({
                    label: `t:${key}`,
                    labelDetails: { description: enums.terms[key] },
                    ...base
                });
            }

            for (const key in enums['mechanic-types']) {
                items.push({
                    label: `m:${key}`,
                    labelDetails: { description: enums['mechanic-types'][key].description },
                    ...base
                });
            }

            for (const key in enums['mechanic-shapes']) {
                items.push({
                    label: `ms:${key}`,
                    labelDetails: { description: enums['mechanic-shapes'][key].description },
                    ...base
                });
            }

            for (const key in enums['status-types']) {
                items.push({
                    label: `st:${key}`,
                    labelDetails: { description: enums['status-types'][key].description },
                    ...base
                });
            }
        }

        return items;
    };
}
