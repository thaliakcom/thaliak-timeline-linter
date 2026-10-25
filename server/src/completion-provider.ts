import { CompletionItem, CompletionItemKind, CompletionParams, TextDocuments, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';
import { getAtPathIfType, getKeyValueAt, getLineAt, getNodeAt, getStrategyKeys, getSymbolAt, ICONS, isInRange, isPositionInYamlRange, NodeWrapper, perPrefix, SPECIAL_TIMELINE_IDS } from './util';
import * as yaml from 'yaml';
import { ElementDefinition, SpecialStatus, SpecialStatuses } from './types/graphing';
import { resolveKey, SPECIAL_ELEMENT_KEYS } from './graphing-resolution';

const base = {
    kind: CompletionItemKind.EnumMember
};

/** Whether `result` is in the `hits` list of a graph step's element: the list itself or one of its entries. */
function isInHits(result: NodeWrapper): boolean {
    const list = yaml.isSeq(result.node) ? result : yaml.isScalar(result.node) && yaml.isSeq(result.parent?.node) ? result.parent : undefined;
    const pair = list?.parent?.node;
    return yaml.isPair(pair) && yaml.isScalar(pair.key) && pair.key.value === 'hits';
}

export default function completionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: CompletionParams) => CompletionItem[] {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const document = documentCache.get(textDocument);

        if (document?.contents == null) {
            return [];
        }

        const elementAction = getKeyValueAt(textDocument, params.position, 'action');
        const elements = getAtPathIfType(document, 'graphing.elements', yaml.isMap);

        // Element sizes only come from the file's own actions (not common ones or special IDs).
        if (elementAction != null && elements != null && isInRange(textDocument, elementAction.range, elements.range!)) {
            const actions = (document.toJS() as UnprocessedRaidData).actions ?? {};

            return Object.entries(actions).map(([key, action]) => ({
                label: key,
                labelDetails: { description: action.description },
                ...base
            }));
        }

        const result = getNodeAt(document, textDocument, params.position);
        let isStatusId = false;
        let isActionId = false;

        if (result == null) {
            return [];
        }

        // The map whose key is being typed: at a key, or on an empty line indented like the map's keys.
        const lineBefore = getLineAt(textDocument, params.position).lineBefore;
        let keyMap: NodeWrapper | null | undefined = null;

        if (yaml.isScalar(result.node) && yaml.isPair(result.parent?.node) && result.parent.node.key === result.node) {
            keyMap = result.parent.parent;
        } else if (lineBefore.trim().length === 0) {
            // At the end of a map, the position belongs to its last value, so look upwards.
            for (let current: NodeWrapper | undefined = result; current != null && keyMap == null; current = current.parent) {
                const firstKey = yaml.isMap(current.node) ? current.node.items[0]?.key : null;

                if (yaml.isNode(firstKey) && firstKey.range != null && textDocument.positionAt(firstKey.range[0]).character === lineBefore.length) {
                    keyMap = current;
                }
            }
        }

        const keyMapParent = keyMap != null && yaml.isMap(keyMap.node) && yaml.isPair(keyMap.parent?.node) && yaml.isScalar(keyMap.parent.node.key)
            ? keyMap.parent.node.key.value
            : null;
        const graphs = getAtPathIfType(document, 'graphing.graphs', yaml.isMap);

        // Strategy keys are graph IDs and vice versa; offer the ones the other side has but this one doesn't.
        if (keyMapParent === 'strategies' || (keyMapParent === 'graphs' && keyMap!.node === graphs)) {
            const existing = new Set((keyMap!.node as yaml.YAMLMap).items.map(x => yaml.isScalar(x.key) ? String(x.key.value) : null));
            const candidates = keyMapParent === 'strategies'
                ? (graphs?.items ?? []).map(x => yaml.isScalar(x.key) ? String(x.key.value) : null)
                : Array.from(getStrategyKeys(document));

            return candidates
                .filter(x => x != null && !existing.has(x))
                .map(x => ({ label: x!, labelDetails: { description: keyMapParent === 'strategies' ? 'graph' : 'strategy' }, ...base }));
        }

        // Hit targets: the elements initialized in the first step of the graph, and the special keys.
        if (isInHits(result)) {
            const graph = graphs?.items.find(x => yaml.isSeq(x.value) && isPositionInYamlRange(textDocument, params.position, x.value.range));
            const firstStep = yaml.isSeq(graph?.value) ? graph.value.items[0] : undefined;
            const targets = new Set([...SPECIAL_ELEMENT_KEYS].filter(x => x !== 'cast' && x !== 'hint'));

            if (yaml.isMap(firstStep)) {
                for (const item of firstStep.items) {
                    if (yaml.isScalar(item.key) && typeof item.key.value === 'string') {
                        try {
                            resolveKey(item.key.value, new Set()).elements.forEach(x => targets.add(x));
                        } catch {
                            // Invalid keys are reported by the linter.
                        }
                    }
                }
            }

            return [...targets].map(x => ({ label: x, ...base }));
        }

        if ((yaml.isScalar(result.node) && typeof result.node.value === 'string' && yaml.isPair(result.parent?.node) && result.parent.node.key === result.node)
         || (yaml.isMap(result.node) && getLineAt(textDocument, params.position).lineBefore.trim().length === 0)) {
            const isScalar = yaml.isScalar(result.node);
            const possibleGraphsKeys = isScalar ? [result.parent?.parent?.parent?.parent?.parent?.parent] : [
                    result.parent?.parent?.parent?.parent?.parent?.parent,
                    result.parent?.parent?.parent?.parent
                ];
            const graphsKeyPair = possibleGraphsKeys.findIndex(x => yaml.isPair(x?.node) && yaml.isScalar(x.node.key) && x.node.key.value === 'graphs');

            if (graphsKeyPair !== -1) {
                const steps = graphsKeyPair === 0 ? result.parent?.parent?.parent : result.parent;

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
        const statusKeyValue = getKeyValueAt(textDocument, params.position, 'status');

        if (keyValue != null) {
            isActionId = true;
        } else if (statusKeyValue != null || (yaml.isSeq(result.node) && yaml.isPair(result.parent?.node) && yaml.isScalar(result.parent.node.key) && result.parent.node.key.value === 'status')) {
            isStatusId = true;
        } else if (!yaml.isScalar(result.node) || typeof result.node.value !== 'string' || (yaml.isPair(result.parent?.node) && result.node === result.parent.node.key)) {
            return [];
        }

        const raidData = document.toJS() as UnprocessedRaidData;
        const symbol = isStatusId || isActionId ? null : getSymbolAt(document, textDocument, params.position, true);
        const actions = raidData?.actions;
        const accumulatedActions: Set<string> = new Set();
        const accumulatedStatuses: Set<string> = new Set();

        if (symbol == null && !isStatusId && !isActionId) {
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
        let accumulateStatus = isStatusId;
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

        if (isStatusId) {
            for (const key in SpecialStatuses) {
                items.push({
                    label: key,
                    labelDetails: { description: SpecialStatuses[key as SpecialStatus].name },
                    sortText: `AAAA${key}`,
                    ...base
                });
            }
        }

        // Replace the placeholder text typed so far explicitly; otherwise VS Code
        // falls back to the YAML wordPattern, which doesn't treat a trailing
        // `a:` as a word and would insert `a:a:<id>`.
        if (symbol != null) {
            const range = { start: symbol.range.start, end: params.position };

            for (const item of items) {
                item.textEdit ??= TextEdit.replace(range, item.insertText ?? item.label);
            }
        }

        return items;
    };
}
