import { DefinitionLink, DefinitionParams, Position, Range, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { getAction, getEntry, getIfType, getRange, getStatus, getSymbolAt, isPositionInYamlRange, perPrefix } from './util';
import { resolveKey } from './graphing-resolution';

function makeDefinitionLink(originRange: Range, textDocument: TextDocument, target: yaml.Pair<yaml.Node<unknown>, yaml.Node<unknown>>): [DefinitionLink] {
    return [{
        originSelectionRange: originRange,
        targetUri: textDocument.uri,
        targetRange: getRange(textDocument, [target.key.range![0], ...target.value!.range!.slice(1)] as yaml.Range),
        targetSelectionRange: getRange(textDocument, target.key.range!)
    }];
}

export default function definitionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: DefinitionParams) => DefinitionLink[] | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const document = documentCache.get(textDocument);

        if (document == null) {
            return null;
        }

        const result = getSymbolAt(document, textDocument, params.position);

        if (result == null) {
            const graphingResult = getGraphingSymbolAt(document, textDocument, params.position);

            if (graphingResult != null) {
                return graphingResult;
            }

            return null;
        }

        const { text: key, range } = result;

        const enums = documentCache.getLinterOptions(settings).enums;

        return perPrefix(key, {
            'a:': key => {
                let action = getAction(document, key);
                let refDocument = textDocument;
    
                if (action == null && enums.common != null) {
                    action = getAction(enums.common.document, key);
                    refDocument = enums.common.textDocument;
                }
    
                if (action != null) {
                    return makeDefinitionLink(range, refDocument, action);
                }
            },
            's:': key => {
                let status = getStatus(document, key);
                let refDocument = textDocument;
    
                if (status == null && enums.common != null) {
                    status = getStatus(enums.common.document, key);
                    refDocument = enums.common.textDocument;
                }
    
                if (status != null) {
                    return makeDefinitionLink(range, refDocument, status);
                }
            },
            't:': key => {
                if (enums.terms != null && yaml.isMap(enums.terms.document.contents)) {
                    const term = getEntry(enums.terms.document.contents, key);
    
                    if (term != null) {
                        return makeDefinitionLink(range, enums.terms.textDocument, term);
                    }
                }
            },
            'm:': key => {
                if (enums['mechanic-types'] != null && yaml.isMap(enums['mechanic-types'].document.contents)) {
                    const mechanicType = getEntry(enums['mechanic-types'].document.contents, key);
    
                    if (mechanicType != null) {
                        return makeDefinitionLink(range, enums['mechanic-types'].textDocument, mechanicType);
                    }
                }
            },
            'ms:': key => {
                if (enums['mechanic-shapes'] != null && yaml.isMap(enums['mechanic-shapes'].document.contents)) {
                    const mechanicShape = getEntry(enums['mechanic-shapes'].document.contents, key);

                    if (mechanicShape != null) {
                        return makeDefinitionLink(range, enums['mechanic-shapes'].textDocument, mechanicShape);
                    }
                }
            },
            'st:': key => {
                if (enums['status-types'] != null && yaml.isMap(enums['status-types'].document.contents)) {
                    const statusType = getEntry(enums['status-types'].document.contents, key);

                    if (statusType != null) {
                        return makeDefinitionLink(range, enums['status-types'].textDocument, statusType);
                    }
                }
            },
            'dt:': key => {
                if (enums['damage-types'] != null && yaml.isMap(enums['damage-types'].document.contents)) {
                    const damageType = getEntry(enums['damage-types'].document.contents, key);

                    if (damageType != null) {
                        return makeDefinitionLink(range, enums['damage-types'].textDocument, damageType);
                    }
                }
            }
        }) ?? null;
    };
}

function getGraphingSymbolAt(document: yaml.Document, textDocument: TextDocument, position: Position): DefinitionLink[] | null {
    const graphing = getIfType(document, 'graphing', yaml.isMap);
    const graphs = getIfType(graphing, 'graphs', yaml.isMap);

    if (graphs == null) {
        return null;
    }

    if (!isPositionInYamlRange(textDocument, position, graphs.range)) {
        return null;
    }

    for (const graph of graphs.items) {
        if (yaml.isScalar(graph.key) && isPositionInYamlRange(textDocument, position, graph.key.range)) {
            const actions = getIfType(document, 'actions', yaml.isMap);

            if (actions != null) {
                for (const action of actions.items) {
                    if (yaml.isMap(action.value)) {
                        const strategies = getIfType(action.value, `strategies`, yaml.isMap);

                        if (strategies != null) {
                            const strategy = getEntry(strategies, graph.key.value as string);

                            if (strategy != null) {
                                return makeDefinitionLink(getRange(textDocument, graph.key.range), textDocument, strategy);
                            }
                        }
                    }
                }
            }
        }

        if (yaml.isSeq(graph.value) && isPositionInYamlRange(textDocument, position, graph.value.range)) {
            let isFirstStep = true;

            for (const step of graph.value.items) {
                if (yaml.isMap(step)) {
                    for (const element of step.items) {
                        if (yaml.isScalar(element.key) && isPositionInYamlRange(textDocument, position, element.key.range)) {
                            const elements = getIfType(graphing, 'elements', yaml.isMap);

                            if (isFirstStep) {
                                const definitionKey = (element.key.value as string).split('#')[0];

                                if (definitionKey != null && elements != null) {
                                    const entry = getEntry(elements, definitionKey);

                                    if (entry != null) {
                                        return makeDefinitionLink(getRange(textDocument, element.key.range), textDocument, entry);
                                    }
                                }
                            } else {
                                // We pass an empty set because we don't really need this function to resolve
                                // the individual elements of a wildcard identifier, which is the only thing
                                // that set is used for. If there's a wildcard, we just navigate to the first
                                // element with that key anyway.
                                const resolvedKey = resolveKey(element.key.value as string, new Set());
                                
                                if ((resolvedKey.elements.length > 0 || resolvedKey.wildcard) && resolvedKey.definition != null) {
                                    const firstStep = graph.value.items[0];

                                    if (yaml.isMap(firstStep)) {
                                        if (resolvedKey.wildcard) {
                                            for (const firstStepElement of firstStep.items) {
                                                if (yaml.isScalar(firstStepElement.key)) {
                                                    const definitionKey = (element.key.value as string).split('#')[0];

                                                    if (definitionKey === resolvedKey.definition) {
                                                        return makeDefinitionLink(getRange(textDocument, element.key.range), textDocument, firstStepElement as any);
                                                    }
                                                }
                                            }
                                        } else {
                                            for (const firstStepElement of firstStep.items) {
                                                if (yaml.isScalar(firstStepElement.key)) {
                                                    const firstStepKey = resolveKey(firstStepElement.key.value as string, new Set());

                                                    if (resolvedKey.definition === firstStepKey.definition && resolvedKey.elements.some(x => firstStepKey.elements.includes(x))) {
                                                        return makeDefinitionLink(getRange(textDocument, element.key.range), textDocument, firstStepElement as any);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                isFirstStep = false;
            }
        }
    }

    return null;
}
