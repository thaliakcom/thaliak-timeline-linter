import { CompletionItem, CompletionItemKind, CompletionParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';
import { getAtPathIfType, getKeyValueAt, getNodeAt, getSymbolAt, ICONS, isPositionInYamlRange, perPrefix, SPECIAL_TIMELINE_IDS } from './util';
import * as yaml from 'yaml';
import { ElementDefinition, SpecialStatus, SpecialStatuses } from './types/graphing';
import { SPECIAL_ELEMENT_KEYS } from './graphing-resolution';

const base = {
    kind: CompletionItemKind.EnumMember
};

export default function completionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: CompletionParams) => CompletionItem[] {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const document = documentCache.get(textDocument);

        if (document?.contents == null) {
            return [];
        }

        const result = getNodeAt(document, textDocument, params.position);
        let isGraphingStatus = false;
        let isActionId = false;

        if (result == null) {
            return [];
        }

        if (yaml.isScalar(result.node) && typeof result.node.value === 'string' && yaml.isPair(result.parent?.node) && result.parent.node.key === result.node) {
            const expectedGraphsKeyPair = result.parent?.parent?.parent?.parent?.parent?.parent;

            if (yaml.isPair(expectedGraphsKeyPair?.node) && yaml.isScalar(expectedGraphsKeyPair.node.key) && expectedGraphsKeyPair.node.key.value === 'graphs') {
                const steps = result.parent?.parent?.parent;

                if (yaml.isSeq(steps?.node) && yaml.isMap(steps.node.items[0])) {
                    const eligibleKeys = new Set<string>(SPECIAL_ELEMENT_KEYS);

                    if (isPositionInYamlRange(textDocument, params.position, steps.node.items[0].range)) {
                        const js = document.toJS();
                        const elements = js.graphing.elements as Record<string, ElementDefinition>;

                        for (const key in elements) {
                            eligibleKeys.add(key);
                        }
                    } else {
                        const firstStepKeys = new Set<string>();

                        for (const item of steps.node.items[0].items) {
                            if (yaml.isScalar(item.key) && typeof item.key.value === 'string') {
                                const definitionKey = item.key.value.split('#')[0] ?? item.key.value;

                                firstStepKeys.add(definitionKey);
                            }
                        }

                        for (const key of firstStepKeys) {
                            eligibleKeys.add(key);
                        }
                    }

                    return eligibleKeys[Symbol.iterator]().map(x => ({ label: x, ...base })).toArray();
                }
            }
        }

        const keyValue = getKeyValueAt(textDocument, params.position, 'id');

        if (keyValue != null) {
            isActionId = true;
        } else if (yaml.isSeq(result.node) && yaml.isPair(result.parent?.node) && yaml.isScalar(result.parent.node.key) && result.parent.node.key.value === 'status') {
            isGraphingStatus = true;
        } else if (!yaml.isScalar(result.node) || typeof result.node.value !== 'string' || (yaml.isPair(result.parent?.node) && result.node === result.parent.node.key)) {
            return [];
        }

        const raidData = document.toJS() as UnprocessedRaidData;
        const symbol = isGraphingStatus || isActionId ? null : getSymbolAt(document, textDocument, params.position, true);
        const actions = raidData?.actions;
        const accumulatedActions: Set<string> = new Set();
        const accumulatedStatuses: Set<string> = new Set();

        if (symbol == null && !isGraphingStatus && !isActionId) {
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

        let accumulateActions = isActionId;
        let accumulateStatus = isGraphingStatus;
        let accumulateTerms = false;
        let accumulateMechanicTypes = false;
        let accumulateMechanicShapes = false;
        let accumulateStatusTypes = false;
        let accumulateDamageTypes = false;
        let accumulateIcons = false;
        let accumulateSpecials = false;

        if (symbol != null) {
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
        }
    
        const items: CompletionItem[] = [];

        if (accumulateActions && actions != null && typeof actions === 'object') {
            for (const key in actions) {
                const action = actions[key];

                items.push({
                    label: symbol?.delimiter != null ? `a:${key}` : key,
                    labelDetails: { description: action.description },
                    sortText: `a1:${key}`,
                    ...base
                });

                accumulatedActions.add(key);
            }

            if (symbol?.delimiter == null) {
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
                    label: symbol?.delimiter != null ? `s:${key}` : key,
                    labelDetails: { description: item.description },
                    sortText: `s1:${key}`,
                    ...base
                });

                accumulatedStatuses.add(key);
            }
        }

        const enums = documentCache.getLinterOptions(settings).enums;

        if (enums.common != null) {
            if (accumulateActions) {
                for (const key in enums.common.yaml.actions) {
                    if (!accumulatedActions.has(key)) {
                        items.push({
                            label: symbol?.delimiter != null ? `a:${key}` : key,
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
                            label: symbol?.delimiter != null ? `s:${key}` : key,
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
                    label: symbol?.delimiter != null ? `t:${key}` : key,
                    labelDetails: { description: enums.terms.yaml[key] },
                    ...base
                });
            }
        }

        if (enums['mechanic-types'] != null && accumulateMechanicTypes) {
            for (const key in enums['mechanic-types'].yaml) {
                items.push({
                    label: symbol?.delimiter != null ? `m:${key}` : key,
                    labelDetails: { description: enums['mechanic-types'].yaml[key].description },
                    ...base
                });
            }
        }

        if (enums['mechanic-shapes'] != null && accumulateMechanicShapes) {
            for (const key in enums['mechanic-shapes'].yaml) {
                items.push({
                    label: symbol?.delimiter != null ? `ms:${key}` : key,
                    labelDetails: { description: enums['mechanic-shapes'].yaml[key].description },
                    ...base
                });
            }
        }

        if (enums['status-types'] != null && accumulateStatusTypes) {
            for (const key in enums['status-types'].yaml) {
                items.push({
                    label: symbol?.delimiter != null ? `st:${key}` : key,
                    labelDetails: { description: enums['status-types'].yaml[key].description },
                    ...base
                });
            }
        }

        if (enums['damage-types'] != null && accumulateDamageTypes) {
            for (const key in enums['damage-types'].yaml) {
                items.push({
                    label: symbol?.delimiter != null ? `dt:${key}` : key,
                    labelDetails: { description: enums['damage-types'].yaml[key].description },
                    ...base
                });
            }
        }

        if (isGraphingStatus) {
            for (const key in SpecialStatuses) {
                items.push({
                    label: key,
                    labelDetails: { description: SpecialStatuses[key as SpecialStatus].name },
                    sortText: `AAAA${key}`,
                    ...base
                });
            }
        }

        return items;
    };
}
