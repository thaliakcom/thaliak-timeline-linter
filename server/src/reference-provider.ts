import { Location, Position, ReferenceParams, TextDocumentPositionParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { findPlaceholders, getAction, getElementActions, getKeyValueAt, getRange, getStatus, getSymbolAt, isPositionInYamlRange, KEY_REGEX, perPrefix, TextRange } from './util';
import { KeyResolverResult, resolveKey } from './graphing-resolution';

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

export default function referenceProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: TextDocumentPositionParams) => Location[] | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const documentText = textDocument.getText();
        const document = documentCache.get(params.textDocument);

        if (document == null) {
            return null;
        }

        const graphingLocations = findGraphingReferences(document, textDocument, params.position);

        if (graphingLocations != null) {
            return graphingLocations;
        }

        let key = getSymbolAt(document, textDocument, params.position);
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

                for (const action of getElementActions(document)) {
                    if (action.value === key) {
                        locations.push(makeLocation(textDocument, action.range!));
                    }
                }
            },
            's:': key => {
                const status = getStatus(document, key);
    
                if (status != null) {
                    locations.push(makeLocation(textDocument, status.key.range!));
                }
            }
        });

        for (const placeholder of findPlaceholders(textDocument, textKey)) {
            locations.push({
                uri: textDocument.uri,
                range: placeholder
            });
        }

        return locations;
    };
}

/** The step element properties whose value is the ID of another element. */
const ELEMENT_REFERENCE_KEYS = new Set(['attach', 'rotate', 'from', 'to']);

/** A mention of graphing elements: a step key, an element reference value or a `hits` entry. */
interface GraphingReference {
    /** The graph (its pair in `graphing.graphs`) the mention is in. */
    graph: yaml.Pair;
    range: yaml.Range;
    /** The text as written. */
    text: string;
    /** Whether {@link text} is a step key. */
    isKey: boolean;
    /** The definition key of a step key, as `resolveKey` finds it. */
    definition?: string;
    /** The element IDs the mention stands for. */
    elements: string[];
}

/** What Find All References looks for: definitions (and plain IDs) in all graphs, or element instances in one graph. */
type GraphingSymbol = { definitions: Set<string> } | { instances: Set<string>, graph: yaml.Pair };

/** The definition key of an element ID (`aoe` for `aoe#2`). */
function definitionOf(id: string): string {
    return id.split('#')[0]!;
}

function tryResolveKey(key: string, elements: Set<string>): KeyResolverResult | undefined {
    try {
        return resolveKey(key, elements);
    } catch {
        return undefined;
    }
}

/** Every mention of graphing elements in `graphs`, resolved against the elements of each graph's first step. */
function* graphingReferences(textDocument: TextDocument, graphs: yaml.YAMLMap): Generator<GraphingReference> {
    for (const graph of graphs.items) {
        if (!yaml.isSeq(graph.value)) {
            continue;
        }

        const firstStep = graph.value.items[0];
        const firstStepElements = new Set<string>();
        const keyText = (key: unknown) => textDocument.getText(getRange(textDocument, (key as yaml.Node).range!));

        if (yaml.isMap(firstStep)) {
            for (const item of firstStep.items) {
                tryResolveKey(keyText(item.key), new Set())?.elements.forEach(x => firstStepElements.add(x));
            }
        }

        for (const step of graph.value.items) {
            if (!yaml.isMap(step)) {
                continue;
            }

            for (const item of step.items) {
                if (yaml.isNode(item.key) && item.key.range != null) {
                    const text = keyText(item.key);
                    const result = tryResolveKey(text, firstStepElements);
                    yield { graph, range: item.key.range, text, isKey: true, definition: result?.definition, elements: result?.elements ?? [] };
                }

                if (!yaml.isMap(item.value)) {
                    continue;
                }

                for (const property of item.value.items) {
                    if (!yaml.isScalar(property.key)) {
                        continue;
                    }

                    const values = ELEMENT_REFERENCE_KEYS.has(String(property.key.value)) ? [property.value]
                        : property.key.value === 'hits' && yaml.isSeq(property.value) ? property.value.items
                        : [];

                    for (const value of values) {
                        if (yaml.isScalar(value) && typeof value.value === 'string' && value.range != null) {
                            const elements = property.key.value === 'hits' ? tryResolveKey(value.value, firstStepElements)?.elements ?? [] : [value.value];
                            yield { graph, range: value.range, text: value.value, isKey: false, elements };
                        }
                    }
                }
            }
        }
    }
}

/**
 * The symbol a mention stands for at `offset`: the ID under the cursor in a comma-separated step
 * key; an element instance (`aoe#2`) in its graph; or plain IDs and definitions in all graphs.
 */
function symbolOf(reference: GraphingReference, offset: number): GraphingSymbol | undefined {
    let ids = reference.elements;

    if (reference.isKey && !reference.text.includes('#') && reference.text.includes(',')) {
        const relative = offset - reference.range[0];
        let start = 0;

        for (const part of reference.text.split(',')) {
            if (relative <= start + part.length) {
                ids = [part.replace(/[[\]]/g, '').trim()];
                break;
            }

            start += part.length + 1;
        }
    }

    if (ids.length === 0) {
        return reference.definition != null ? { definitions: new Set([reference.definition]) } : undefined;
    }

    return ids.every(id => !id.includes('#')) ? { definitions: new Set(ids) } : { instances: new Set(ids), graph: reference.graph };
}

/**
 * Find All References for graphing element IDs (in `graphing.elements`, step keys, `attach`,
 * `rotate`, `from`, `to` and `hits`), resolved like the diagrams resolve them rather than by text.
 * `null` if the position isn't on one.
 */
function findGraphingReferences(document: yaml.Document, textDocument: TextDocument, position: Position): Location[] | null {
    const graphing = document.get('graphing', true);

    if (!yaml.isMap(graphing) || !isPositionInYamlRange(textDocument, position, graphing.range)) {
        return null;
    }

    const elements = graphing.get('elements', true);
    const graphs = graphing.get('graphs', true);
    const references = yaml.isMap(graphs) ? Array.from(graphingReferences(textDocument, graphs)) : [];
    const offset = textDocument.offsetAt(position);
    let symbol: GraphingSymbol | undefined;

    if (yaml.isMap(elements)) {
        const definition = elements.items.find(item => yaml.isScalar(item.key) && isPositionInYamlRange(textDocument, position, item.key.range));

        if (definition != null) {
            symbol = { definitions: new Set([String((definition.key as yaml.Scalar).value)]) };
        }
    }

    if (symbol == null) {
        const reference = references.find(x => offset >= x.range[0] && offset <= x.range[1]);
        symbol = reference != null ? symbolOf(reference, offset) : undefined;
    }

    if (symbol == null) {
        return null;
    }

    const locations: Location[] = [];

    if ('definitions' in symbol && yaml.isMap(elements)) {
        for (const item of elements.items) {
            if (yaml.isScalar(item.key) && symbol.definitions.has(String(item.key.value))) {
                locations.push(makeLocation(textDocument, item.key.range!));
            }
        }
    }

    for (const reference of references) {
        const matches = 'definitions' in symbol
            ? reference.elements.some(id => symbol.definitions.has(definitionOf(id))) || (reference.definition != null && symbol.definitions.has(reference.definition))
            : reference.graph === symbol.graph && reference.elements.some(id => symbol.instances.has(id));

        if (matches) {
            locations.push(makeLocation(textDocument, reference.range));
        }
    }

    return locations;
}
