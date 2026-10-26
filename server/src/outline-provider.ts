import { Location, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { getStatusIcon } from './tooltip';
import { OutlineIcon, OutlineNode, OutlineParams } from './types/outline';
import { formatTime, getAction, getIfType, getRange } from './util';

type ActionPair = yaml.Pair<yaml.Scalar<string>, yaml.Node<unknown>>;

/** An action looked up by its key, in the timeline or in `enums/common.yaml`. */
interface ResolvedAction {
    pair: ActionPair;
    textDocument: TextDocument;
}

/**
 * Builds the timeline tree view of a timeline file: its `status`, `actions`, `timeline` (grouped
 * by `<phase>`) and `graphing` sections, in the order they appear in the file. `null` if the
 * file isn't a timeline. Status rows get their in-game icon, if game data is on.
 */
export default function outlineProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: OutlineParams) => Promise<OutlineNode[] | null> {
    return async (params) => {
        const textDocument = documents.get(params.uri);
        const document = textDocument != null ? documentCache.get(textDocument) : null;

        if (textDocument == null || document == null || !yaml.isMap(document.contents)) {
            return null;
        }

        const common = documentCache.getLinterOptions(settings).enums.common;
        /** The status icon lookups, which fill in the rows once they're done. */
        const gameData: Promise<void>[] = [];

        function resolveAction(key: unknown): ResolvedAction | null {
            if (typeof key !== 'string') {
                return null;
            }

            const pair = getAction(document!, key);

            if (pair != null) {
                return { pair, textDocument: textDocument! };
            }

            const commonPair = common != null ? getAction(common.document, key) : null;

            return commonPair != null ? { pair: commonPair, textDocument: common!.textDocument } : null;
        }

        /** The range from the start of `pair`'s key through the end of its value. */
        function pairRange(pair: yaml.Pair): yaml.Range {
            const keyRange = (pair.key as yaml.Node).range!;
            const valueRange = yaml.isNode(pair.value) && pair.value.range != null ? pair.value.range : keyRange;

            return [keyRange[0], valueRange[1], valueRange[2]];
        }

        function keyRange(pair: yaml.Pair): yaml.Range {
            return (pair.key as yaml.Node).range!;
        }

        function shapeIcon(action: ResolvedAction | null): OutlineIcon {
            const shape = action != null && yaml.isMap(action.pair.value) ? action.pair.value.get('shape') : undefined;

            return { kind: 'shape', shape: typeof shape === 'string' ? shape : undefined };
        }

        function definitionOf(action: ResolvedAction | null): Location | undefined {
            if (action == null) {
                return undefined;
            }

            return { uri: action.textDocument.uri, range: getRange(action.textDocument, keyRange(action.pair)) };
        }

        /** `<text> (<id>)`, or whichever of the two exists. */
        function describe(text: unknown, id: unknown): string | undefined {
            const parts = [typeof text === 'string' ? text : null, id != null ? `(${id})` : null].filter(x => x != null);

            return parts.length > 0 ? parts.join(' ') : undefined;
        }

        function sectionNode(pair: yaml.Pair, children: OutlineNode[]): OutlineNode {
            const name = String((pair.key as yaml.Scalar).value);

            return {
                label: name,
                icon: { kind: 'section', name },
                range: getRange(textDocument!, pairRange(pair)),
                selection: getRange(textDocument!, keyRange(pair)),
                children
            };
        }

        /** The rows of an action's `children`, timed relative to `parentAt` (or as `+offset` if it's `null`). */
        function childNodes(action: ResolvedAction | null, parentAt: number | null): OutlineNode[] {
            const children = action != null && yaml.isMap(action.pair.value) ? getIfType(action.pair.value, 'children', yaml.isSeq) : null;
            const nodes: OutlineNode[] = [];

            for (const child of children?.items ?? []) {
                if (!yaml.isMap(child) || child.range == null) {
                    continue;
                }

                const at = child.get('at');
                const id = child.get('id');
                const childAction = resolveAction(id);
                const childRange = getRange(action!.textDocument, child.range);

                nodes.push({
                    label: typeof at !== 'number' ? '?' : parentAt == null ? `+${formatTime(at)}` : formatTime(parentAt + at),
                    description: typeof id === 'string' ? id : undefined,
                    icon: shapeIcon(childAction),
                    range: childRange,
                    selection: childRange,
                    definition: definitionOf(childAction),
                    symbol: childAction != null ? `a:${id}` : undefined
                });
            }

            return nodes;
        }

        function statusNodes(status: yaml.YAMLMap): OutlineNode[] {
            return status.items.filter(pair => yaml.isScalar(pair.key) && pair.key.range != null).map(pair => {
                const value = yaml.isMap(pair.value) ? pair.value : null;
                const id = value?.get('id');
                const type = value?.get('type');
                const icon: OutlineIcon & { kind: 'status' } = { kind: 'status', statusId: typeof id === 'number' ? id : undefined, dot: type === 'dot' };

                if (typeof id === 'number') {
                    gameData.push(getStatusIcon(id, value?.get('icon')).then(gameIcon => {
                        icon.path = gameIcon?.path;
                    }));
                }

                return {
                    label: String((pair.key as yaml.Scalar).value),
                    description: describe(type, id),
                    icon,
                    range: getRange(textDocument!, pairRange(pair)),
                    selection: getRange(textDocument!, keyRange(pair)),
                    references: textDocument!.positionAt(keyRange(pair)[0]),
                    symbol: `s:${(pair.key as yaml.Scalar).value}`
                };
            });
        }

        function actionNodes(actions: yaml.YAMLMap): OutlineNode[] {
            return actions.items.filter(pair => yaml.isScalar(pair.key) && pair.key.range != null).map(pair => {
                const action: ResolvedAction = { pair: pair as ActionPair, textDocument: textDocument! };
                const value = yaml.isMap(pair.value) ? pair.value : null;
                const children = childNodes(action, null);

                return {
                    label: String((pair.key as yaml.Scalar).value),
                    description: describe(value?.get('mechanic'), value?.get('id')),
                    icon: shapeIcon(action),
                    range: getRange(textDocument!, pairRange(pair)),
                    selection: getRange(textDocument!, keyRange(pair)),
                    references: textDocument!.positionAt(keyRange(pair)[0]),
                    children: children.length > 0 ? children : undefined,
                    symbol: `a:${(pair.key as yaml.Scalar).value}`
                };
            });
        }

        function timelineNodes(timeline: yaml.YAMLSeq): OutlineNode[] {
            const nodes: OutlineNode[] = [];
            let phase: OutlineNode | null = null;

            for (const item of timeline.items) {
                if (!yaml.isMap(item) || item.range == null) {
                    continue;
                }

                const at = item.get('at');
                const id = item.get('id');
                const idNode = item.get('id', true);
                const itemRange = getRange(textDocument!, item.range);

                if (id === '<phase>') {
                    const name = item.get('name');

                    phase = {
                        label: typeof at === 'number' ? formatTime(at) : '?',
                        description: typeof name === 'string' ? name : undefined,
                        icon: { kind: 'phase' },
                        range: itemRange,
                        selection: itemRange,
                        children: []
                    };
                    nodes.push(phase);
                    continue;
                }

                const action = resolveAction(id);
                const children = action != null ? childNodes(action, typeof at === 'number' ? at : 0) : [];
                const node: OutlineNode = {
                    label: typeof at === 'number' ? formatTime(at) : '?',
                    description: typeof id === 'string' ? id : undefined,
                    icon: shapeIcon(action),
                    range: itemRange,
                    selection: yaml.isScalar(idNode) && idNode.range != null ? getRange(textDocument!, idNode.range) : itemRange,
                    definition: definitionOf(action),
                    children: children.length > 0 ? children : undefined,
                    symbol: action != null ? `a:${id}` : undefined
                };

                if (phase != null) {
                    phase.children!.push(node);
                    // The phase spans its items, so that the cursor finds them inside it.
                    phase.range = { start: phase.range.start, end: itemRange.end };
                } else {
                    nodes.push(node);
                }

                if (id === '<endphase>') {
                    phase = null;
                }
            }

            return nodes;
        }

        function graphingNodes(graphing: yaml.YAMLMap): OutlineNode[] {
            const nodes: OutlineNode[] = [];

            for (const pair of graphing.items) {
                if (!yaml.isScalar(pair.key) || pair.key.range == null || !yaml.isMap(pair.value)) {
                    continue;
                }

                if (pair.key.value === 'elements') {
                    nodes.push(sectionNode(pair, elementNodes(pair.value)));
                } else if (pair.key.value === 'graphs') {
                    nodes.push(sectionNode(pair, graphNodes(pair.value)));
                }
            }

            return nodes;
        }

        function elementNodes(elements: yaml.YAMLMap): OutlineNode[] {
            return elements.items.filter(pair => yaml.isScalar(pair.key) && pair.key.range != null).map(pair => {
                const value = yaml.isMap(pair.value) ? pair.value : null;
                const type = value?.get('type');
                const rawLook = value?.get('look');
                const look = yaml.isMap(rawLook) ? rawLook.get('type') : rawLook;

                return {
                    label: String((pair.key as yaml.Scalar).value),
                    description: typeof look === 'string' ? look : undefined,
                    icon: { kind: 'element', key: String((pair.key as yaml.Scalar).value), type: typeof type === 'string' ? type : undefined, look: typeof look === 'string' ? look : undefined },
                    range: getRange(textDocument!, pairRange(pair)),
                    selection: getRange(textDocument!, keyRange(pair)),
                    references: textDocument!.positionAt(keyRange(pair)[0])
                };
            });
        }

        function graphNodes(graphs: yaml.YAMLMap): OutlineNode[] {
            return graphs.items.filter(pair => yaml.isScalar(pair.key) && pair.key.range != null).map(pair => {
                const steps = yaml.isSeq(pair.value) ? pair.value.items : [];

                return {
                    label: String((pair.key as yaml.Scalar).value),
                    icon: { kind: 'graph' },
                    range: getRange(textDocument!, pairRange(pair)),
                    selection: getRange(textDocument!, keyRange(pair)),
                    references: textDocument!.positionAt(keyRange(pair)[0]),
                    children: steps.filter(step => yaml.isNode(step) && step.range != null).map((step, i) => {
                        const stepRange = getRange(textDocument!, (step as yaml.Node).range!);

                        return { label: `step ${i + 1}`, icon: { kind: 'step' }, range: stepRange, selection: stepRange };
                    })
                };
            });
        }

        const sections: OutlineNode[] = [];

        for (const pair of document.contents.items) {
            if (!yaml.isScalar(pair.key) || pair.key.range == null) {
                continue;
            }

            if (pair.key.value === 'status' && yaml.isMap(pair.value)) {
                sections.push(sectionNode(pair, statusNodes(pair.value)));
            } else if (pair.key.value === 'actions' && yaml.isMap(pair.value)) {
                sections.push(sectionNode(pair, actionNodes(pair.value)));
            } else if (pair.key.value === 'timeline' && yaml.isSeq(pair.value)) {
                sections.push(sectionNode(pair, timelineNodes(pair.value)));
            } else if (pair.key.value === 'graphing' && yaml.isMap(pair.value)) {
                sections.push(sectionNode(pair, graphingNodes(pair.value)));
            }
        }

        await Promise.all(gameData);

        return sections;
    };
}
