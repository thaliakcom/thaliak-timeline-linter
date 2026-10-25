import { Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity, DiagnosticTag, TextEdit } from 'vscode-languageserver';
import { Range, TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { DEFAULT_GRAPHICS_KEYS, KeyResolverResult, RESERVED_ELEMENTS, resolveKey, SPECIAL_ELEMENT_KEYS } from './graphing-resolution';
import { LinterInput } from './linter';
import { LinterOptions, PropertyOrder } from './server';
import { SpecialStatuses } from './types/graphing';
import { UnprocessedRaidData, WipKind } from './types/raids';
import { getElementActions, getEntry, getIfType, getRange, getRangeAt, getRangeFromOffset, getRangeOrStart, getStrategyKeys, ICONS, perPrefix, PLACEHOLDER_REGEX, SPECIAL_TIMELINE_IDS } from './util';

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
        yaml.isScalar(wip.value) ? wip.value.value === 'full' : (yaml.isSeq(wip.value) && wip.value.items.some(x => yaml.isScalar(x) && x.value === kind)),
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

export function* mustSpecifyArena({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const [wip, wipRange] = isWip(document, 'timeline');

    if (!wip && !document.has('arena')) {
        yield* diagnostics({
            code: 'missing-arena',
            severity: DiagnosticSeverity.Error,
            message: `Field 'arena' is required in timeline files without the "timeline" work-in-progress kind.`,
            range: getRangeOrStart(textDocument, wipRange)
        });
    }
}

/**
 * Whether the fight has multiple phases with their own `hp`, i.e. phases against
 * different enemies, which usually have different auto-attacks.
 */
function hasIsolatedPhases(document: yaml.Document): boolean {
    let count = 0;

    for (const item of traverseTimelineItems(document)) {
        if (item.get('id') === '<phase>' && item.has('hp')) {
            count++;
        }
    }

    return count > 1;
}

export function* mustSpecifyAutoAttacks({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const [wip, wipRange] = isWip(document, 'damage');

    if (!wip && !document.has('autos') && !hasIsolatedPhases(document)) {
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

                            // After the step's keys, so that a hit can target an element initialized later in the first step.
                            yield* validateHits(step, first, firstStepElements, textDocument);
                        }

                        first = false;
                    }
                }
            }
        }
    }
}

/**
 * Checks the `hits` of a graph step's elements: each entry must be a valid step key whose elements
 * are initialized in the first step of the graph (`firstStepElements`), without wildcards in the first step.
 */
function* validateHits(step: yaml.YAMLMap, first: boolean, firstStepElements: Set<string>, textDocument: TextDocument): Generator<Diagnostic> {
    for (const item of step.items) {
        const hits = yaml.isMap(item.value) ? getIfType(item.value, 'hits', yaml.isSeq) : undefined;

        for (const entry of hits?.items ?? []) {
            if (!yaml.isScalar(entry) || typeof entry.value !== 'string') {
                continue;
            }

            const range = getRange(textDocument, entry.range!);
            let result: KeyResolverResult;

            try {
                result = resolveKey(entry.value, firstStepElements);
            } catch (e) {
                yield* diagnostics({ code: 'graphing-error', severity: DiagnosticSeverity.Error, message: (e as Error).message, range });
                continue;
            }

            if (result.wildcard && first) {
                yield* diagnostics({
                    code: 'first-step-wildcard',
                    severity: DiagnosticSeverity.Error,
                    message: 'Wildcards in element identifiers may only be used in step 2 and onwards.',
                    range
                });
            }

            for (const element of result.elements) {
                if (!firstStepElements.has(element) && !SPECIAL_ELEMENT_KEYS.has(element)) {
                    yield* diagnostics({
                        code: 'unresolved-graphing-element',
                        severity: DiagnosticSeverity.Error,
                        message: `Failed to resolve hit target '${element}'. All elements must be initialized in the first step of a graph.`,
                        range
                    });
                }
            }
        }
    }
}

/** The diagram element types that `elements: shapes` in `enums/animations.yaml` refers to. */
const SHAPE_TYPES: string[] = ['donut', 'ellipse', 'cone', 'rectangle'];

/**
 * The build-time diagram checks from `processGraphing()` in thaliak's `data.ts`, except
 * for those that need game data (an action's `effectRange` and `XAxisModifier`) or the
 * arena image's size (`margin`).
 */
export function* validateDiagramElements({ textDocument, document, options }: LinterInput): Generator<Diagnostic> {
    const graphing = getIfType(document, 'graphing', yaml.isMap);
    const elements = getIfType(graphing, 'elements', yaml.isMap);
    const graphs = getIfType(graphing, 'graphs', yaml.isMap);
    const actions = getIfType(document, 'actions', yaml.isMap);
    const looks = options.enums.looks?.yaml;
    const animations = options.enums.animations?.yaml;
    /** Step keys with several elements check the same node more than once. */
    const reported = new Set<string>();

    function* error(code: string, range: yaml.Range, message: string): Generator<Diagnostic> {
        const id = `${range[0]}:${message}`;

        if (!reported.has(id)) {
            reported.add(id);

            yield* diagnostics({ code, severity: DiagnosticSeverity.Error, message, range: getRange(textDocument, range) });
        }
    }

    /** The definition in `elements` that a step key (or one element of it) refers to. */
    function getDefinition(key: string): yaml.YAMLMap | undefined {
        const definition = elements?.get(key.trim().split('#')[0]!, true);

        return yaml.isMap(definition) ? definition : undefined;
    }

    function getType(key: string): string | undefined {
        const type = getDefinition(key)?.get('type');

        return typeof type === 'string' ? type : undefined;
    }

    function* checkDonutSize(data: yaml.YAMLMap, key: string): Generator<Diagnostic> {
        const size = data.get('size', true);

        if (getType(key) === 'donut' && yaml.isSeq(size)) {
            const [inner, outer] = size.items.map(x => yaml.isScalar(x) ? x.value : undefined);

            if (typeof inner === 'number' && typeof outer === 'number' && inner >= outer) {
                yield* error('invalid-donut-size', size.range!, `Donut size [${inner}, ${outer}] must be [inner diameter, outer diameter].`);
            }
        }
    }

    /** Reports `in`/`out` animations that aren't allowed on the type of the element(s) `key` refers to. */
    function* checkAnimations(data: yaml.YAMLMap, key: string): Generator<Diagnostic> {
        for (const field of ['in', 'out'] as const) {
            const node = data.get(field, true);
            const allowed = yaml.isScalar(node) ? animations?.[field === 'in' ? 'enter' : 'exit']?.[node.value as string]?.elements : undefined;

            if (allowed == null || allowed === 'all') {
                continue;
            }

            for (const part of key.split(',')) {
                // Predefined IDs (boss, players, ...) without a definition are images.
                const type = getType(part) ?? 'image';
                const ok = allowed === 'shapes' ? SHAPE_TYPES.includes(type) : allowed.includes(type);

                if (!ok) {
                    yield* error('invalid-animation', node!.range!, `'${field}: ${node!.value}' is only allowed on ${allowed === 'shapes' ? 'shapes' : allowed.join(', ')}, but '${part.trim()}' has type ${type}.`);
                }
            }
        }
    }

    /**
     * Reports a `color` on a shape or link, or a `width` on a link, whose look isn't `plain`,
     * which ignores it. `look` is the look the element had before, if `data` doesn't set one.
     */
    function* checkColor(data: yaml.YAMLMap, key: string, look: string | undefined): Generator<Diagnostic> {
        const type = getType(key);
        const ownLook = data.get('look');
        const resolved = (typeof ownLook === 'string' ? ownLook : undefined) ?? look ?? 'plain';

        if (type == null || resolved === 'plain' || !(SHAPE_TYPES.includes(type) || type === 'link')) {
            return;
        }

        for (const field of type === 'link' ? ['color', 'width'] : ['color']) {
            const entry = getEntry(data, field);

            if (entry != null) {
                yield* error('ignored-by-look', entry.key.range!, `'${field}' is ignored with 'look: ${resolved}'; remove it or use 'look: plain'.`);
            }
        }
    }

    /** Reports a `look` that isn't one of the looks of its element's type. */
    function* checkLook(data: yaml.YAMLMap, key: string): Generator<Diagnostic> {
        const type = getType(key);
        const look = data.get('look', true);

        if (type == null || !yaml.isScalar(look)) {
            return;
        }

        const list = SHAPE_TYPES.includes(type) ? 'aoes' : type === 'link' ? 'tethers' : type === 'marker' ? 'markers' : undefined;

        if (list == null) {
            yield* error('invalid-look', look.range!, `${type} elements have no look.`);
        } else if (looks != null && !Object.hasOwn(looks[list], look.value as string)) {
            yield* error('invalid-look', look.range!, `'${look.value}' isn't one of the ${list} in 'enums/looks.yaml': '${Object.keys(looks[list]).join('\', \'')}'`);
        }
    }

    /** Reports an `image` that is the URL a marker used to be referenced by (`/images/markers/stack.svg`). */
    function* checkImage(data: yaml.YAMLMap): Generator<Diagnostic> {
        const image = data.get('image', true);
        const name = yaml.isScalar(image) && typeof image.value === 'string' ? /^\/images\/(?:markers|other)\/([a-z-]+)\.svg$/.exec(image.value)?.[1] : undefined;

        if (name != null && looks != null && Object.hasOwn(looks.markers, name)) {
            yield* error('marker-image', image!.range!, `${image!.value} is a marker; use 'type: marker' with 'look: ${name}'.`);
        }
    }

    function* checkMargin(data: yaml.YAMLMap, key: string): Generator<Diagnostic> {
        const margin = getEntry(data, 'margin');

        if (margin != null && key !== 'arena') {
            yield* error('invalid-margin', margin.key.range!, `Only the arena can have a margin.`);
        }
    }

    for (const item of elements?.items ?? []) {
        if (!yaml.isScalar(item.key) || !yaml.isMap(item.value)) {
            continue;
        }

        const id = String(item.key.value);

        yield* checkDonutSize(item.value, id);
        yield* checkAnimations(item.value, id);
        yield* checkColor(item.value, id, undefined);
        yield* checkLook(item.value, id);
        yield* checkImage(item.value);
        yield* checkMargin(item.value, id);

        const action = item.value.get('action', true);

        if (yaml.isScalar(action) && action.value != null) {
            if (actions == null || !actions.has(action.value)) {
                yield* error('invalid-id', action.range!, `Unresolved action ${action.value}. Diagram elements can only be sized by actions defined in this file.`);
            } else if (getType(id) === 'donut' && !item.value.has('size')) {
                yield* error('missing-donut-size', action.range!, `Game data has no inner radius; specify a size [inner diameter, outer diameter].`);
            }
        }
    }

    for (const graph of graphs?.items ?? []) {
        if (!yaml.isSeq(graph.value)) {
            continue;
        }

        /** The looks set by this graph's steps so far, by step key. */
        const stepLooks = new Map<string, string>();

        for (const step of graph.value.items) {
            if (!yaml.isMap(step)) {
                continue;
            }

            for (const item of step.items) {
                if (!yaml.isMap(item.value)) {
                    continue;
                }

                // Unquoted keys like `[M2, T2]` are sequences, which the build (js-yaml) joins into `M2,T2`.
                const id = yaml.isScalar(item.key) ? String(item.key.value)
                    : yaml.isSeq(item.key) ? item.key.items.map(x => yaml.isScalar(x) ? String(x.value) : '').join(',')
                    : undefined;

                if (id == null) {
                    continue;
                }

                yield* checkDonutSize(item.value, id);
                yield* checkAnimations(item.value, id);
                yield* checkImage(item.value);
                yield* checkMargin(item.value, id);

                // Only exact keys are tracked; wildcard and range keys fall back to the definition's look.
                for (const key of id.includes('#') ? [id] : id.split(',').map(x => x.trim())) {
                    const base = getDefinition(key)?.get('look');

                    yield* checkColor(item.value, key, stepLooks.get(key) ?? (typeof base === 'string' ? base : undefined));
                    yield* checkLook(item.value, key);

                    const look = item.value.get('look');

                    if (typeof look === 'string') {
                        stepLooks.set(key, look);
                    }
                }
            }
        }
    }
}

export function* actionsMustBeUsed({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const actions = getIfType(document, 'actions', yaml.isMap);

    if (actions == null) {
        return;
    }

    const used = new Set<string>();

    for (const item of traverseTimelineItems(document)) {
        const id = item.get('id');

        if (typeof id === 'string') {
            used.add(id);
        }
    }

    for (const action of getElementActions(document)) {
        used.add(String(action.value));
    }

    for (const match of textDocument.getText().matchAll(PLACEHOLDER_REGEX)) {
        const text = match[1] ?? match[2];

        if (text.startsWith('a:')) {
            used.add(text.slice(2));
        }
    }

    for (const action of actions.items) {
        if (yaml.isScalar(action.key) && action.key.range != null && !used.has(String(action.key.value))) {
            yield* diagnostics({
                code: 'unused-action',
                severity: DiagnosticSeverity.Hint,
                tags: [DiagnosticTag.Unnecessary],
                message: `Action '${action.key.value}' is never used in the timeline, in children, in diagrams or in placeholders.`,
                range: getRange(textDocument, action.key.range)
            });
        }
    }
}

export function* lastChildMustNotHaveLink({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const actions = getIfType(document, 'actions', yaml.isMap);

    for (const action of actions?.items ?? []) {
        const children = yaml.isMap(action.value) ? getIfType(action.value, 'children', yaml.isSeq) : null;
        const last = children?.items[children.items.length - 1];
        const link = yaml.isMap(last) ? getEntry(last, 'link') : undefined;

        if (link != null) {
            yield* diagnostics({
                code: 'last-child-link',
                severity: DiagnosticSeverity.Error,
                message: `The last child of an action must not have a 'link'.`,
                range: getRange(textDocument, link.key.range!)
            });
        }
    }
}

/** The descriptions thaliak-cli generates for actions and statuses that still need a real one. */
const PLACEHOLDER_DESCRIPTION_REGEX = /^(?:Placeholder description|castType: \d+, cast100ms: \d+, omenPath: \S+)$/;

export function* mustNotHavePlaceholderDescriptions({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    if (isWip(document, 'timeline')[0] || isWip(document, 'guide')[0]) {
        return;
    }

    for (const kind of ['actions', 'status'] as const) {
        for (const item of getIfType(document, kind, yaml.isMap)?.items ?? []) {
            const description = yaml.isMap(item.value) ? item.value.get('description', true) : null;

            if (yaml.isScalar(description) && typeof description.value === 'string' && PLACEHOLDER_DESCRIPTION_REGEX.test(description.value.trim())) {
                yield* diagnostics({
                    code: 'placeholder-description',
                    severity: DiagnosticSeverity.Error,
                    message: `This is still the description generated by thaliak-cli. Replace it, or add "guide" to 'wip'.`,
                    range: getRange(textDocument, description.range!)
                });
            }
        }
    }
}

export function* graphsMustBeUsed({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    const graphs = getIfType(getIfType(document, 'graphing', yaml.isMap), 'graphs', yaml.isMap);

    if (graphs == null) {
        return;
    }

    const strategies = getStrategyKeys(document);

    for (const graph of graphs.items) {
        if (yaml.isScalar(graph.key) && graph.key.range != null && !strategies.has(String(graph.key.value))) {
            yield* diagnostics({
                code: 'unused-graph',
                severity: DiagnosticSeverity.Warning,
                message: `No action has a strategy named '${graph.key.value}', so this diagram is never shown.`,
                range: getRange(textDocument, graph.key.range)
            });
        }
    }
}

/** The fields whose text is shown to readers, and is held to the Author's Guide. */
const PROSE_KEYS = new Set(['description', 'resolve', 'trivia', 'caption', 'tips', 'mistakes']);

/** The damage adjectives of the Author's Guide to use instead of others. */
const DAMAGE_ADJECTIVES: Record<string, string> = {
    'light': 'mild',
    'small': 'mild',
    'low': 'mild',
    'little': 'minimal',
    'minor': 'minimal',
    'medium': 'moderate',
    'high': 'heavy',
    'big': 'heavy',
    'significant': 'heavy',
    'considerable': 'heavy',
    'a lot of': 'heavy',
    'lots of': 'heavy',
    'severe': 'massive',
    'huge': 'massive',
    'extreme': 'massive',
    'tons of': 'massive'
};

interface WordingRule {
    code: string;
    regex: RegExp;
    message: string;
    /** The replacement for the first capture group, if the problem can be fixed automatically. */
    replace?: (match: RegExpMatchArray) => string;
}

/** The wording rules from the Author's Guide (see the data repository's wiki) that can be checked by pattern. */
const WORDING_RULES: WordingRule[] = [
    {
        code: 'wording/damage-amount',
        // Not followed by words that make "damage" part of another noun (a damage buff).
        regex: new RegExp(`\\b(${Object.keys(DAMAGE_ADJECTIVES).map(x => x.replace(' ', '\\s+')).join('|')})\\s+damage\\b(?!\\s+(?:buff|up|down|debuff|increase|reduction|taken|bonus))`, 'gi'),
        message: `Describe amounts of damage as minimal, mild, moderate, heavy, massive or lethal.`,
        replace: match => DAMAGE_ADJECTIVES[match[1]!.toLowerCase().replace(/\s+/g, ' ')]!
    },
    {
        code: 'wording/deal-damage',
        regex: /\b(do|does|doing|did|done)\s+(?:\w+\s+)?damage\b/gi,
        message: `Use "deal damage" instead of "do damage".`,
        replace: match => ({ do: 'deal', does: 'deals', doing: 'dealing', did: 'dealt', done: 'dealt' })[match[1]!.toLowerCase()]!
    },
    {
        code: 'wording/inflict-status',
        // Only where a status placeholder follows within a few words; "apply" is fine for other things.
        regex: /\b(apply|applies|applying|applied)\s+(?:[\w-]+\s+){0,2}(?=\[s:|\[[^\]\n]*\]\(s:)/gi,
        message: `Use "inflict" for harmful and "grant" for beneficial status effects instead of "apply".`
    },
    {
        code: 'wording/afflicted',
        // Not fixed automatically: "affected" is right for players hit by an attack.
        regex: /\b(affected)\s+players?\b/gi,
        message: `Use "afflicted players" for players under a harmful status effect.`
    },
    {
        code: 'wording/player',
        regex: /\b(party\s+members?)\b/gi,
        message: `Use "player" instead of "party member".`,
        replace: match => /s$/i.test(match[1]!) ? 'players' : 'player'
    },
    {
        code: 'wording/kill',
        regex: /\b(KO(?:s|'d|ed|ing)?)\b/g,
        message: `Use "kill" or "death" instead of "KO".`
    }
];

/** Yields the string scalars in `node` that are values of {@link PROSE_KEYS} (or items of their lists). */
function* getProse(node: unknown, key?: string): Generator<yaml.Scalar<string>> {
    if (yaml.isMap(node)) {
        for (const pair of node.items) {
            yield* getProse(pair.value, yaml.isScalar(pair.key) ? String(pair.key.value) : undefined);
        }
    } else if (yaml.isSeq(node)) {
        for (const item of node.items) {
            yield* getProse(item, key === 'tips' || key === 'mistakes' ? key : undefined);
        }
    } else if (yaml.isScalar(node) && typeof node.value === 'string' && node.range != null && key != null && PROSE_KEYS.has(key)) {
        yield node as yaml.Scalar<string>;
    }
}

/** Matches the case of `original`'s first letter on `replacement`. */
function matchCase(original: string, replacement: string): string {
    return original[0] === original[0]!.toUpperCase() ? replacement[0]!.toUpperCase() + replacement.slice(1) : replacement;
}

export function* proseMustFollowWordingRules({ textDocument, document }: LinterInput): Generator<Diagnostic> {
    for (const scalar of getProse(document.contents)) {
        // The source text, so that offsets stay right in block and folded scalars.
        const offset = scalar.range![0];
        const text = textDocument.getText().slice(offset, scalar.range![1]);

        for (const rule of WORDING_RULES) {
            for (const match of text.matchAll(rule.regex)) {
                const start = offset + match.index! + match[0].indexOf(match[1]!);
                const range = getRangeFromOffset(textDocument, start, start + match[1]!.length);

                yield* diagnostics({
                    code: rule.code,
                    severity: DiagnosticSeverity.Information,
                    message: rule.message,
                    range,
                    data: rule.replace != null ? { textEdits: [TextEdit.replace(range, matchCase(match[1]!, rule.replace(match)))] satisfies TextEdit[] } : undefined
                });
            }
        }
    }
}
