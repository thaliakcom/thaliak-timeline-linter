import { Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity, TextEdit } from 'vscode-languageserver';
import { Range, TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { DEFAULT_GRAPHICS_KEYS, KeyResolverResult, RESERVED_ELEMENTS, resolveKey, SPECIAL_ELEMENT_KEYS } from './graphing-resolution';
import { LinterInput } from './linter';
import { LinterOptions, PropertyOrder } from './server';
import { SpecialStatuses } from './types/graphing';
import { UnprocessedRaidData, WipKind } from './types/raids';
import { getEntry, getIfType, getRange, getRangeAt, getRangeFromOffset, getRangeOrStart, ICONS, perPrefix, PLACEHOLDER_REGEX, SPECIAL_TIMELINE_IDS } from './util';

function* diagnostics(diagnostic: Diagnostic): Generator<Diagnostic> {
    diagnostic.source = 'thaliak';

    yield diagnostic;

    if (diagnostic.relatedInformation != null) {
        for (const relatedInformation of diagnostic.relatedInformation) {
            yield {
                severity: DiagnosticSeverity.Hint,
                message: relatedInformation.message,
                range: relatedInformation.location.range,
                relatedInformation: [{
                    message: 'The original problem comes from here.',
                    location: { uri: relatedInformation.location.uri, range: diagnostic.range }
                }]
            };
        }
    }
}

function* validateTimelineItems(items: yaml.YAMLSeq, textDocument: TextDocument, document: yaml.Document, options: LinterOptions): Generator<Diagnostic> {
    let lastAt: number = 0;
    let lastAtRange: yaml.Range | undefined;

    const js = document.toJS() as UnprocessedRaidData;
    const actions = js.actions;

    for (const item of items.items) {
        if (!yaml.isMap(item)) {
            continue;
        }

        yield* validatePropertyOrder(item, 'timeline item', false, textDocument, options);

        const at = item.get('at', true);
        const actionId = item.get('id') as string;

        if (at != null && typeof at.value === 'number') {
            if (lastAtRange != null && lastAt > at.value) {
                yield* diagnostics({
                    code: 'timeline-order',
                    severity: DiagnosticSeverity.Error,
                    message: `All timeline items must be in order, but this item (at ${at.value}ms) comes before the last item (at ${lastAt}ms).`,
                    range: getRange(textDocument, at.range!),
                    relatedInformation: [
                        {
                            location: { uri: textDocument.uri, range: getRange(textDocument, lastAtRange) },
                            message: `Item should be placed before this one.`
                        }
                    ]
                });
            }

            lastAt = at.value;
            lastAtRange = at.range!;
        }

        if (actionId === '<addstatus>' || actionId === '<removestatus>') {
            const status: yaml.Scalar[] = [];
            const statusProperty = item.get('status', true) as yaml.Node | undefined;

            if (yaml.isScalar(statusProperty)) {
                status.push(statusProperty);
            } else if (yaml.isSeq(statusProperty)) {
                for (const item of statusProperty.items) {
                    if (yaml.isScalar(item)) {
                        status.push(item);
                    }
                }
            }

            if (status.length === 0) {
                yield* diagnostics({
                    code: 'missing-status',
                    severity: DiagnosticSeverity.Error,
                    message: `The special timeline items <addstatus> and <removestatus> require at least one status effect to be specified.`,
                    range: getRange(textDocument, item.get('id', true)!.range ?? [0, 0, 0])
                });
            } else if (status != null) {
                const json = document.toJS();

                for (const id of status) {
                    if (typeof id.value === 'string') {
                        const exists = (json.status != null && id.value in json.status) || (options.enums.common != null && id.value in options.enums.common.yaml.status) || id.value in SpecialStatuses;

                        if (!exists) {
                            yield* diagnostics({
                                code: 'invalid-id',
                                severity: DiagnosticSeverity.Error,
                                message: `Unresolved status effect ${id.value}. Did you forget to define it?`,
                                range: getRange(textDocument, id.range ?? [0, 0, 0])
                            });
                        }
                    }
                }
            }
        }

        if (actions != null) {
            const action = actions[actionId];

            if (action != null) {
                const count = item.get('count', true);
                if (count != null && count.value === action.count) {
                    yield* diagnostics({
                        code: 'redundant-count',
                        severity: DiagnosticSeverity.Error,
                        message: `This value can be inferred from '${actionId}' and should be omitted.`,
                        range: getRange(textDocument, count.range!)
                    });
                }

                const players = item.get('players', true);
                const mechanicType = options.enums['mechanic-types']?.yaml[action.mechanic as string];

                if (players != null) {
                    const type = players.value === action.players
                        ? actionId
                        : mechanicType != null && players.value === mechanicType.players
                            ? action.mechanic
                            : null;

                    if (type != null) {
                        yield* diagnostics({
                            code: 'redundant-players',
                            severity: DiagnosticSeverity.Error,
                            message: `This value can be inferred from '${type}' and should be omitted.`,
                            range: getRange(textDocument, players.range!)
                        });
                    }
                }
            }
        }
    }

    return true;
}

function getOrSet<K, V>(map: Map<K, V>, key: K, defaultValue: () => V): V {
    let value = map.get(key);

    if (value == null) {
        value = defaultValue();
        map.set(key, value);
    }

    return value;
}

function emptyMap(): Map<never, never> {
    return new Map<never, never>();
}

function updateOrderItem(order: Map<string, PropertyOrder>, orderItem: PropertyOrder, after: string | undefined, before: string | undefined, range: Range): void {
    let hasChanged = false;
    let afterItem = orderItem.after;
    let beforeItem = orderItem.before;

    if (afterItem !== after) {
        if (afterItem == null) {
            afterItem = after;
            hasChanged = true;
        } else if (after != null) {
            while (afterItem != null) {
                const item = order.get(afterItem);

                if (item == null) {
                    orderItem.after = after;
                    hasChanged = true;
                    break;
                } else if (item.after === after) {
                    break;
                } else {
                    afterItem = item.after;
                }
            }
        }
    }

    if (beforeItem !== before) {
        if (beforeItem == null) {
            beforeItem = before;
            hasChanged = true;
        } else if (before != null) {
            while (beforeItem != null) {
                const item = order.get(beforeItem);

                if (item == null) {
                    orderItem.before = before;
                    hasChanged = true;
                    break;
                } else if (item.before === before) {
                    break;
                } else {
                    beforeItem = item.before;
                }
            }
        }
    }

    if (hasChanged) {
        orderItem.range = range;
    }
}

function* validatePropertyOrder(map: yaml.YAMLMap, itemKind: string, codeAction: boolean, textDocument: TextDocument, options: LinterOptions): Generator<Diagnostic> {
    const order = getOrSet(options.propOrder, itemKind, emptyMap);
    const keysBefore: string[] = [];

    for (let i: number = 0, j: number = 0; i < map.items.length; i++, j++) {
        const key = map.items[i].key;

        if (!yaml.isScalar(key)) {
            continue;
        }

        const value = key.value as string;
        const orderItem = order.get(value);

        const after = map.items[i - 1]?.key as yaml.Scalar<string> | undefined;
        const before = map.items[i + 1]?.key as yaml.Scalar<string> | undefined;
        const range = getRange(textDocument, key.range!);

        if (orderItem == null) {
            order.set(value, {
                range,
                after: after?.value,
                before: before?.value
            });
        } else {
            let orderAfter = orderItem.after;
            let orderBefore = orderItem.before;

            while (orderAfter != null && !map.has(orderAfter)) {
                orderAfter = order.get(orderAfter)?.after;
            }

            while (orderBefore != null && !map.has(orderBefore)) {
                orderBefore = order.get(orderBefore)?.before;
            }

            if ((orderAfter != null && !keysBefore.includes(orderAfter)) || (orderBefore != null && keysBefore.includes(orderBefore))) {
                const insertionItem = (orderAfter == null
                    ? (map.items.find(x => (x.key as yaml.Scalar).value === orderBefore))!
                    : (map.items.find(x => (x.key as yaml.Scalar).value === orderAfter))!) as yaml.Pair<yaml.Scalar<string>, yaml.Node>;
                const relatedInformation: DiagnosticRelatedInformation = orderAfter == null ? {
                    location: { uri: textDocument.uri, range: getRange(textDocument, insertionItem.key.range!) },
                    message: `'${value}' should come before '${orderBefore}'.`
                } : {
                    location: { uri: textDocument.uri, range: getRange(textDocument, insertionItem.key.range!) },
                    message: `'${value}' should come after '${orderAfter}'.`
                };

                const currentRange = getRangeFromOffset(textDocument, (map.items[i].key as yaml.Scalar).range![0], (map.items[i].value as yaml.Node).range![2]);
                currentRange.start.character = 0;

                const codeActionData = codeAction ? {
                    textEdits: [
                        {
                            range: currentRange,
                            newText: ''
                        },
                        {
                            range: orderAfter == null ? getRangeAt(textDocument, insertionItem.key.range![0], 'start') : getRangeAt(textDocument, insertionItem.value!.range![2], 'start'),
                            newText: textDocument.getText(currentRange)
                        }
                    ] satisfies TextEdit[],
                    uniqueness: map.range?.toString()
                } : undefined;

                yield* diagnostics({
                    code: `inconsistent-prop-order/${itemKind.replaceAll(' ', '-')}`,
                    severity: DiagnosticSeverity.Warning,
                    message: `The order of this '${value}' is inconsistent.`,
                    range: getRange(textDocument, (map.items[i].key as yaml.Scalar).range!),
                    relatedInformation: [
                        relatedInformation,
                        {
                            location: { uri: textDocument.uri, range: orderItem.range },
                            message: `The order of '${value}' was last adjusted here.`
                        }
                    ],
                    data: codeActionData
                });
            } else {
                updateOrderItem(order, orderItem, after?.value, before?.value, range);
            }
        }

        keysBefore.push(value);
    }

    return true;
}

export function* validateAction({ textDocument, document, options }: LinterInput): Generator<Diagnostic> {
    if (options.enums['mechanic-types'] == null) {
        return;
    }

    const actions = document.get('actions');

    if (yaml.isMap(actions)) {
        for (const action of actions.items) {
            if (yaml.isScalar(action.key) && action.key.range != null && yaml.isMap(action.value)) {
                yield* validatePropertyOrder(action.value, 'action', true, textDocument, options);

                const mechanic = action.value.get('mechanic', true);
                const damage = getEntry(action.value, 'damage');
                const hasDamage = damage != null && yaml.isScalar(damage.value) && damage.value.value as number > 0;

                const children = action.value.get('children');

                if (yaml.isSeq(children)) {
                    yield* validateTimelineItems(children, textDocument, document, options);
                }

                if (mechanic == null) {
                    yield* diagnostics({
                        code: 'missing-mechanic',
                        severity: DiagnosticSeverity.Error,
                        message: `Every action must specify the 'mechanic' field.\nIf no suitable mechanic type exists, add one to 'enums/mechanic-types.yaml'.`,
                        range: getRange(textDocument, action.key.range)
                    });
                }

                if (!action.value.has('id') && !action.value.has('name')) {
                    yield* diagnostics({
                        code: 'missing-name',
                        severity: DiagnosticSeverity.Error,
                        message: `An action must set either a valid 'id' or a custom 'name'.`,
                        range: getRange(textDocument, action.key.range)
                    });
                }

                const shape = action.value.get('shape', true);

                if (shape != null && options.enums['mechanic-shapes'] != null && options.enums['mechanic-shapes'].yaml[shape.value as string] == null) {
                    yield* diagnostics({
                        code: 'invalid-shape',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'shape' field must be one of the following values: '${Object.keys(options.enums['mechanic-shapes'].yaml).join('\', \'')}'`,
                        range: getRange(textDocument, shape.range!)
                    });
                }

                const damageType = action.value.get('type', true);

                if (damageType != null && options.enums['damage-types'] != null && options.enums['damage-types'].yaml[damageType.value as string] == null) {
                    yield* diagnostics({
                        code: 'invalid-damage-type',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'type' field must be one of the following values: '${Object.keys(options.enums['damage-types'].yaml).join('\', \'')}'`,
                        range: getRange(textDocument, damageType.range!)
                    });
                }

                if (!yaml.isScalar(mechanic)) {
                    continue;
                }

                const mechanicType = options.enums['mechanic-types'].yaml[mechanic.value as string];

                if (mechanicType == null) {
                    yield* diagnostics({
                        code: 'invalid-mechanic',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'mechanic' field must be one of the following values: '${Object.keys(options.enums['mechanic-types'].yaml).join('\', \'')}'`,
                        range: getRange(textDocument, mechanic.range!)
                    });

                    continue;
                }

                if (mechanicType.players == null && hasDamage && !action.value.has('players')) {
                    yield* diagnostics({
                        code: 'missing-players',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'players' field must be set for mechanic type '${mechanic.value}'`,
                        range: getRange(textDocument, action.key.range),
                        relatedInformation: [
                            {
                                location: { uri: textDocument.uri, range: getRange(textDocument, damage.key.range!) },
                                message: `Or remove this 'damage' field to avoid having to set 'players'.`
                            }
                        ]
                    });
                }
                
                const count = action.value.get('count') as number ?? 1;
                const players = action.value.get('players', true);

                if (mechanicType.players != null && players?.value === mechanicType.players && (mechanicType.players * count) <= 8) {
                    yield* diagnostics({
                        code: 'redundant-players',
                        severity: DiagnosticSeverity.Warning,
                        message: `This value can be inferred from '${mechanic.value}' and should be omitted.`,
                        range: getRange(textDocument, players.range!)
                    });
                }

                if (mechanicType.shapeful === true && shape == null) {
                    yield* diagnostics({
                        code: 'missing-shape',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'shape' field must be set for mechanic type '${mechanic.value}'`,
                        range: getRange(textDocument, action.key.range)
                    });
                }

                if (!action.value.has('players') && mechanicType.players != null) {
                    const totalPlayersHit = mechanicType.players * count;
    
                    if (totalPlayersHit > 8) {
                        yield* diagnostics({
                            code: 'too-many-players-hit',
                            severity: DiagnosticSeverity.Warning,
                            message: `With ${count} instances of this mechanic and a 'players' value of ${mechanicType.players}, this mechanic targets more players than fit in a full party! Explicitly set the 'players' field to silence this warning.`,
                            range: getRange(textDocument, action.key.range)
                        });
                    }
                }

                if ((players != null || mechanicType.players != null) && !action.value.has('damage') && mechanic.value !== 'raidwide.sethp' && !action.value.has('children')) {
                    yield* diagnostics({
                        code: 'missing-damage',
                        severity: DiagnosticSeverity.Error,
                        message: `This action specifies that ${players ?? mechanicType.players} players take damage, but the 'damage' field is missing.`,
                        range: getRange(textDocument, action.key.range)
                    });
                }
            }
        }
    }
}

export function* validateStatus({ textDocument, document, options }: LinterInput): Generator<Diagnostic> {
    const statusEffects = document.get('status');
    
    if (yaml.isMap(statusEffects)) {
        for (const status of statusEffects.items) {
            if (!yaml.isScalar(status.key) || status.key.range == null || !yaml.isMap(status.value)) {
                continue;
            }

            yield* validatePropertyOrder(status.value, 'status effect', true, textDocument, options);

            const type = status.value.get('type', true);

            if (type == null) {
                yield* diagnostics({
                    code: 'missing-status-type',
                    severity: DiagnosticSeverity.Error,
                    message: `Every status must specify the 'type' field.\nIf no suitable status type exists, add one to 'enums/status-types.yaml'.`,
                    range: getRange(textDocument, status.key.range)
                });

                continue;
            }

            if (options.enums['status-types'] != null && options.enums['status-types'].yaml[type.value as string] == null) {
                yield* diagnostics({
                    code: 'invalid-mechanic',
                    severity: DiagnosticSeverity.Error,
                    message: `The 'type' field must be one of the following values: '${Object.keys(options.enums['status-types'].yaml).join('\', \'')}'`,
                    range: getRange(textDocument, type.range!)
                });
            }

            if (type.value === 'dot' && !status.value.has('tick')) {
                yield* diagnostics({
                    code: 'missing-tick',
                    severity: DiagnosticSeverity.Error,
                    message: `Damage-over-time status effects must define the tick damage (via 'tick').`,
                    range: getRange(textDocument, type.range!)
                });
            }
        }
    }
}

function isWip(document: yaml.Document, kind: WipKind): [boolean, yaml.Range | undefined] {
    if (!yaml.isMap(document.contents)) {
        return [false, undefined];
    }

    const wip = getEntry(document.contents, 'wip');

    if (wip == null) {
        return [false, undefined];
    }

    return [
        yaml.isScalar(wip.value) ? wip.value.value === 'full' : (yaml.isSeq(wip.value) && wip.value.items.includes(kind)),
        wip.key.range ?? undefined
    ];
}

export function* mustSpecifyPartyHP({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const [wip, wipRange] = isWip(document, 'damage');

    if (!wip && !document.has('party_hp')) {
        yield* diagnostics({
            code: 'missing-party-hp',
            severity: DiagnosticSeverity.Error,
            message: `Field 'party_hp' is required in timeline files without the "damage" work-in-progress kind.`,
            range: getRangeOrStart(textDocument, wipRange)
        });
    }
}

export function* mustSpecifyAutoAttacks({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const [wip, wipRange] = isWip(document, 'damage');

    if (!wip && !document.has('autos')) {
        yield* diagnostics({
            code: 'missing-auto-attacks',
            severity: DiagnosticSeverity.Error,
            message: `Field 'autos' is required in timeline files without the "damage" work-in-progress kind.`,
            range: getRangeOrStart(textDocument, wipRange)
        });
    }
}

export function* mustHaveAtLeastOneAuthor({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const by = getEntry(document.contents as yaml.YAMLMap, 'by');

    if (by != null && ((yaml.isSeq(by.value) && !by.value.items.some(x => !yaml.isMap(x) || x.get('role') === 'author')) || yaml.isMap(by.value) && by.value.get('role') !== 'author')) {
        yield* diagnostics({
            code: 'missing-author',
            severity: DiagnosticSeverity.Error,
            message: `Field 'by' must contain at least one contributor with the 'author' role.`,
            range: getRange(textDocument, by.key.range!)
        });
    }
}

function *traverseTimelineItems(document: yaml.Document): Generator<yaml.YAMLMap> {
    const actions = document.get('actions');

    if (yaml.isMap(actions)) {
        for (const action of actions.items) {
            if (yaml.isMap(action.value)) {
                const children = action.value.get('children');

                if (yaml.isSeq(children)) {
                    for (const child of children.items) {
                        if (yaml.isMap(child)) {
                            yield child;
                        }
                    }
                }
            }
        }
    }

    const timeline = document.get('timeline');

    if (yaml.isSeq(timeline)) {
        for (const item of timeline.items) {
            if (yaml.isMap(item)) {
                yield item;
            }
        }
    }
}

export function* idMustBeValid({ textDocument, document, options }: LinterInput): Generator<Diagnostic> {
    const matches: { text: string, range: [number, number, number?] }[] = [];

    for (const match of textDocument.getText().matchAll(PLACEHOLDER_REGEX)) {
        const text = match[1] ?? match[2];
        matches.push({ text: text, range: [match.index! + 1, match.index! + 1 + text.length] });
    }

    for (const item of traverseTimelineItems(document)) {
        const id = item.get('id', true);

        if (yaml.isScalar(id) && typeof id.value === 'string') {
            matches.push({ text: `a:${id.value}`, range: id.range! });
        }
    }

    const json = document.toJS() as UnprocessedRaidData;

    for (const match of matches) {
        const isValid = perPrefix(match.text, {
            'a:': key => (json.actions != null && key in json.actions) || (options.enums.common != null && key in options.enums.common.yaml.actions) || SPECIAL_TIMELINE_IDS.some(x => x.id === key),
            's:': key => (json.status != null && key in json.status) || (options.enums.common != null && key in options.enums.common.yaml.status),
            'm:': key => options.enums['mechanic-types'] != null && key in options.enums['mechanic-types'].yaml,
            'ms:': key => options.enums['mechanic-shapes'] != null && key in options.enums['mechanic-shapes'].yaml,
            'st:': key => options.enums['status-types'] != null && key in options.enums['status-types'].yaml,
            'dt:': key => options.enums['damage-types'] != null && key in options.enums['damage-types'].yaml,
            't:': key => options.enums.terms != null && key in options.enums.terms.yaml,
            'i:': key => ICONS.includes(key as typeof ICONS[number])
        });

        if (!isValid) {
            yield* diagnostics({
                code: 'invalid-id',
                severity: DiagnosticSeverity.Error,
                message: `Unresolved ${perPrefix(match.text, {
                    'a:': key => `action ${key}`,
                    's:': key => `status effect ${key}`,
                    'm:': key => `mechanic type ${key}`,
                    'ms:': key => `mechanic shape ${key}`,
                    'st:': key => `status effect type ${key}`,
                    't:': key => `term ${key}`,
                    'i:': key => `icon ${key}`
                })}. Did you forget to define it?`,
                range: getRange(textDocument, [match.range[0], match.range[1], match.range[2] ?? match.range[1]])
            });
        }
    }
}

export function* mustNotHaveRecursiveChildren({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const graph: yaml.Scalar[] = [];
    const recursiveGraphs: string[] = [];

    const actions = document.get('actions');

    if (actions != null && yaml.isMap(actions)) {
        for (const item of actions.items) {
            yield* checkAction(item);
        }
    }

    function* checkAction(action: yaml.Pair): Generator<Diagnostic> {
        if (!yaml.isScalar(action.key) || !yaml.isMap(action.value)) {
            return;
        }

        const children = action.value.get('children');

        if (children == null || !yaml.isSeq(children)) {
            return;
        }

        graph.push(action.key as yaml.Scalar);

        for (const child of children.items) {
            if (!yaml.isMap(child)) {
                continue;
            }

            const id = child.get('id', true);

            if (!yaml.isScalar(id)) {
                continue;
            }

            if (graph.some(x => x.value === id.value)) {
                const recursiveGraph = `${graph.map(x => x.value).join(' -> ')} -> ${id.value}`;

                if (recursiveGraphs.some(x => x.includes(recursiveGraph))) {
                    // We already emitted a diagnostic for this recursion.
                    continue;
                }

                yield* diagnostics({
                    code: 'recursion',
                    severity: DiagnosticSeverity.Error,
                    message: `This child is contained in itself: ${recursiveGraph}`,
                    range: getRange(textDocument, id.range!),
                    relatedInformation: graph.map(x => ({
                        location: { uri: textDocument.uri, range: getRange(textDocument, x.range!) },
                        message: `This action is part of the recursion graph.`
                    }))
                });

                recursiveGraphs.push(recursiveGraph);
                continue;
            }

            const childAction = (actions as yaml.YAMLMap).items.find(x => yaml.isScalar(x.key) && x.key.value === id.value);

            if (childAction != null) {
                yield* checkAction(childAction);
            }
        }

        graph.pop();
    }
}

export function* validateTimeline({ textDocument, document, options }: LinterInput): Generator<Diagnostic> {
    const timeline = getIfType(document, 'timeline', yaml.isSeq);

    if (timeline != null) {
        yield* validateTimelineItems(timeline, textDocument, document, options);
    }
}

export function* validateGraphingItems({ textDocument, document, options }: LinterInput): Generator<Diagnostic> {
    const graphing = getIfType(document, 'graphing', yaml.isMap);

    if (graphing != null) {
        const elements = getIfType(graphing, 'elements', yaml.isMap);
        const graphs = getIfType(graphing, 'graphs', yaml.isMap);
        
        if (elements != null && graphs != null) {
            const resolvedElements = new Set<string>();

            for (const item of elements.items) {
                if (yaml.isScalar(item.key) && typeof item.key.value === 'string') {
                    if (RESERVED_ELEMENTS.has(item.key.value)) {
                        yield* diagnostics({
                            code: 'reserved-graphing-element',
                            severity: DiagnosticSeverity.Error,
                            message: `'${item.key.value}' is a reserved element.`,
                            range: getRange(textDocument, (item.key as yaml.Node).range!)
                        });
                    } else {
                        resolvedElements.add(item.key.value);
                    }
                }
            }

            for (const graph of graphs.items) {
                if (yaml.isSeq(graph.value)) {
                    let first = true;
                    const firstStepElements = new Set<string>();

                    for (const step of graph.value.items) {
                        if (yaml.isMap(step)) {
                            for (const item of step.items) {
                                const key = textDocument.getText(getRange(textDocument, (item.key as yaml.Node).range!));
                                let result: KeyResolverResult;

                                try {
                                    result = resolveKey(key, firstStepElements);
                                } catch (e) {
                                    yield* diagnostics({
                                        code: 'graphing-error',
                                        severity: DiagnosticSeverity.Error,
                                        message: (e as Error).message,
                                        range: getRange(textDocument, (item.key as yaml.Node).range!)
                                    });

                                    continue;
                                }

                                if (result.wildcard && first) {
                                    yield* diagnostics({
                                        code: 'first-step-wildcard',
                                        severity: DiagnosticSeverity.Error,
                                        message: 'Wildcards in element identifiers may only be used in step 2 and onwards.',
                                        range: getRange(textDocument, (item.key as yaml.Node).range!)
                                    });
                                }

                                const definitions = result.definition != null ? [result.definition] : result.elements;

                                for (const definition of definitions) {
                                    if (!resolvedElements.has(definition) && !SPECIAL_ELEMENT_KEYS.has(definition)) {
                                        yield* diagnostics({
                                            code: 'unresolved-graphing-element',
                                            severity: DiagnosticSeverity.Error,
                                            message: `Failed to resolve '${definition}'. Did you remember to add the element definition to 'elements'?`,
                                            range: getRange(textDocument, (item.key as yaml.Node).range!)
                                        });
                                    }
                                }

                                for (const element of result.elements) {
                                    if (DEFAULT_GRAPHICS_KEYS.has(element)) {
                                        continue;
                                    }

                                    if (first) {
                                        firstStepElements.add(element);
                                    } else if (!firstStepElements.has(element)) {
                                        yield* diagnostics({
                                            code: 'uninitialized-graphing-element',
                                            severity: DiagnosticSeverity.Error,
                                            message: `Found uninitialized element '${element}'. All elements must be initialized in the first step of a graph.`,
                                            range: getRange(textDocument, (item.key as yaml.Node).range!)
                                        });
                                    }
                                }

                                if (yaml.isMap(item.value)) {
                                    const status = getIfType(item.value, 'status', yaml.isSeq);

                                    if (status != null) {
                                        const json = document.toJS();

                                        for (const id of status.items) {
                                            if (yaml.isScalar(id) && typeof id.value === 'string') {
                                                const exists = (json.status != null && id.value in json.status) || (options.enums.common != null && id.value in options.enums.common.yaml.status) || id.value in SpecialStatuses;

                                                if (!exists) {
                                                    yield* diagnostics({
                                                        code: 'invalid-id',
                                                        severity: DiagnosticSeverity.Error,
                                                        message: `Unresolved status effect ${id.value}. Did you forget to define it?`,
                                                        range: getRange(textDocument, id.range ?? item.value.range ?? [0, 0, 0])
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        first = false;
                    }
                }
            }
        }
    }
}
