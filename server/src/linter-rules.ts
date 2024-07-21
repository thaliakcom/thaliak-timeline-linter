import { Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity, TextEdit } from 'vscode-languageserver';
import * as yaml from 'yaml';
import { LinterInput } from './linter';
import { fixableDiagnostics, LinterOptions, PropertyOrder } from './server';
import { UnprocessedRaidData } from './types/raids';
import { getEntry, getIfType, getRange, getRangeAt, getRangeFromOffset, ICONS, perPrefix, PLACEHOLDER_REGEX, SPECIAL_TIMELINE_IDS } from './util';
import { Range, TextDocument } from 'vscode-languageserver-textdocument';

function addDiagnostic(diagnostics: Diagnostic[], settings: LinterOptions, diagnostic: Diagnostic): boolean {
    diagnostic.source = 'thaliak';

    diagnostics.push(diagnostic);

    if (diagnostic.relatedInformation != null) {
        for (const relatedInformation of diagnostic.relatedInformation) {
            diagnostics.push({
                severity: DiagnosticSeverity.Hint,
                message: relatedInformation.message,
                range: relatedInformation.location.range,
                relatedInformation: [{
                    message: 'The original problem comes from here.',
                    location: { uri: relatedInformation.location.uri, range: diagnostic.range }
                }]
            });
        }
    }

    if (diagnostic.data != null && diagnostic.data.textEdits != null) {
        fixableDiagnostics.push(diagnostic);
    }

    return diagnostics.length < settings.maxNumberOfProblems;
}

function validateTimelineItems(items: yaml.YAMLSeq, textDocument: TextDocument, document: yaml.Document, diagnostics: Diagnostic[], options: LinterOptions): boolean {
    let lastAt: number = 0;
    let lastAtRange: yaml.Range | undefined;

    const actions = (document.toJS() as UnprocessedRaidData).actions;

    for (const item of items.items) {
        if (!yaml.isMap(item)) {
            continue;
        }

        if (!validatePropertyOrder(item, 'timeline item', false, textDocument, document, diagnostics, options)) {
            return false;
        }

        const at = item.get('at', true);

        if (at != null && typeof at.value === 'number') {
            if (lastAtRange != null && lastAt > at.value) {
                if (!addDiagnostic(diagnostics, options, {
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
                })) {
                    return false;
                }
            }
    
            lastAt = at.value;
            lastAtRange = at.range!;
        }

        if (actions != null) {
            const actionId = item.get('id') as string;
            const action = actions[actionId];

            if (action != null) {
                const count = item.get('count', true);
                if (count != null && count.value === action.count) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'redundant-count',
                        severity: DiagnosticSeverity.Error,
                        message: `This value can be inferred from '${actionId}' and should be omitted.`,
                        range: getRange(textDocument, count.range!)
                    })) {
                        return false;
                    }
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
                        if (!addDiagnostic(diagnostics, options, {
                            code: 'redundant-players',
                            severity: DiagnosticSeverity.Error,
                            message: `This value can be inferred from '${type}' and should be omitted.`,
                            range: getRange(textDocument, players.range!)
                        })) {
                            return false;
                        }
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

function validatePropertyOrder(map: yaml.YAMLMap, itemKind: string, codeAction: boolean, textDocument: TextDocument, document: yaml.Document, diagnostics: Diagnostic[], options: LinterOptions): boolean {
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

                if (!addDiagnostic(diagnostics, options, {
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
                })) {
                    return false;
                }
            } else {
                updateOrderItem(order, orderItem, after?.value, before?.value, range);
            }
        }

        keysBefore.push(value);
    }

    return true;
}

export function validateAction({ diagnostics, textDocument, document, options }: LinterInput): void {
    if (options.enums['mechanic-types'] == null) {
        return;
    }

    const actions = document.get('actions');

    if (yaml.isMap(actions)) {
        for (const action of actions.items) {
            if (yaml.isScalar(action.key) && action.key.range != null && yaml.isMap(action.value)) {
                if (!validatePropertyOrder(action.value, 'action', true, textDocument, document, diagnostics, options)) {
                    return;
                }

                const mechanic = action.value.get('mechanic', true);
                const damage = getEntry(action.value, 'damage');
                const hasDamage = damage != null && yaml.isScalar(damage.value) && damage.value.value as number > 0;

                const children = action.value.get('children');

                if (yaml.isSeq(children)) {
                    if (!validateTimelineItems(children, textDocument, document, diagnostics, options)) {
                        return;
                    }
                }

                if (mechanic == null) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'missing-mechanic',
                        severity: DiagnosticSeverity.Error,
                        message: `Every action must specify the 'mechanic' field.\nIf no suitable mechanic type exists, add one to 'enums/mechanic-types.yaml'.`,
                        range: getRange(textDocument, action.key.range)
                    })) {
                        return;
                    }
                }

                if (!action.value.has('id') && !action.value.has('name')) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'missing-name',
                        severity: DiagnosticSeverity.Error,
                        message: `An action must set either a valid 'id' or a custom 'name'.`,
                        range: getRange(textDocument, action.key.range)
                    })) {
                        return;
                    }
                }

                const shape = action.value.get('shape', true);

                if (shape != null && options.enums['mechanic-shapes'] != null && options.enums['mechanic-shapes'].yaml[shape.value as string] == null) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'invalid-shape',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'shape' field must be one of the following values: '${Object.keys(options.enums['mechanic-shapes'].yaml).join('\', \'')}'`,
                        range: getRange(textDocument, shape.range!)
                    })) {
                        return;
                    }
                }

                const damageType = action.value.get('type', true);

                if (damageType != null && options.enums['damage-types'] != null && options.enums['damage-types'].yaml[damageType.value as string] == null) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'invalid-damage-type',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'type' field must be one of the following values: '${Object.keys(options.enums['damage-types'].yaml).join('\', \'')}'`,
                        range: getRange(textDocument, damageType.range!)
                    })) {
                        return;
                    }
                }

                if (!yaml.isScalar(mechanic)) {
                    continue;
                }

                const mechanicType = options.enums['mechanic-types'].yaml[mechanic.value as string];

                if (mechanicType == null) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'invalid-mechanic',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'mechanic' field must be one of the following values: '${Object.keys(options.enums['mechanic-types'].yaml).join('\', \'')}'`,
                        range: getRange(textDocument, mechanic.range!)
                    })) {
                        return;
                    }

                    continue;
                }

                if (mechanicType.players == null && hasDamage && !action.value.has('players')) {
                    if (!addDiagnostic(diagnostics, options, {
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
                    })) {
                        return;
                    }
                }
                
                const count = action.value.get('count') as number ?? 1;
                const players = action.value.get('players', true);

                if (mechanicType.players != null && players?.value === mechanicType.players && (mechanicType.players * count) <= 8) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'redundant-players',
                        severity: DiagnosticSeverity.Warning,
                        message: `This value can be inferred from '${mechanic.value}' and should be omitted.`,
                        range: getRange(textDocument, players.range!)
                    })) {
                        return;
                    }
                }

                if (mechanicType.shapeful === true && shape == null) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'missing-shape',
                        severity: DiagnosticSeverity.Error,
                        message: `The 'shape' field must be set for mechanic type '${mechanic.value}'`,
                        range: getRange(textDocument, action.key.range)
                    })) {
                        return;
                    }
                }

                if (!action.value.has('players') && mechanicType.players != null) {
                    const totalPlayersHit = mechanicType.players * count;
    
                    if (totalPlayersHit > 8) {
                        if (!addDiagnostic(diagnostics, options, {
                            code: 'too-many-players-hit',
                            severity: DiagnosticSeverity.Warning,
                            message: `With ${count} instances of this mechanic and a 'players' value of ${mechanicType.players}, this mechanic targets more players than fit in a full party! Explicitly set the 'players' field to silence this warning.`,
                            range: getRange(textDocument, action.key.range)
                        })) {
                            return;
                        }
                    }
                }

                if ((players != null || mechanicType.players != null) && !action.value.has('damage') && mechanic.value !== 'raidwide.sethp' && !action.value.has('children')) {
                    if (!addDiagnostic(diagnostics, options, {
                        code: 'missing-damage',
                        severity: DiagnosticSeverity.Error,
                        message: `This action specifies that ${players ?? mechanicType.players} players take damage, but the 'damage' field is missing.`,
                        range: getRange(textDocument, action.key.range)
                    })) {
                        return;
                    }
                }
            }
        }
    }
}

export function validateStatus({ diagnostics, textDocument, document, options }: LinterInput): void {
    const statusEffects = document.get('status');
    
    if (yaml.isMap(statusEffects)) {
        for (const status of statusEffects.items) {
            if (!yaml.isScalar(status.key) || status.key.range == null || !yaml.isMap(status.value)) {
                continue;
            }

            if (!validatePropertyOrder(status.value, 'status effect', true, textDocument, document, diagnostics, options)) {
                return;
            }

            const type = status.value.get('type', true);

            if (type == null) {
                if (!addDiagnostic(diagnostics, options, {
                    code: 'missing-status-type',
                    severity: DiagnosticSeverity.Error,
                    message: `Every status must specify the 'type' field.\nIf no suitable status type exists, add one to 'enums/status-types.yaml'.`,
                    range: getRange(textDocument, status.key.range)
                })) {
                    return;
                }

                continue;
            }

            if (options.enums['status-types'] != null && options.enums['status-types'].yaml[type.value as string] == null) {
                if (!addDiagnostic(diagnostics, options, {
                    code: 'invalid-mechanic',
                    severity: DiagnosticSeverity.Error,
                    message: `The 'type' field must be one of the following values: '${Object.keys(options.enums['status-types'].yaml).join('\', \'')}'`,
                    range: getRange(textDocument, type.range!)
                })) {
                    return;
                }
            }

            if (type.value === 'dot' && !status.value.has('tick')) {
                if (!addDiagnostic(diagnostics, options, {
                    code: 'missing-tick',
                    severity: DiagnosticSeverity.Error,
                    message: `Damage-over-time status effects must define the tick damage (via 'tick').`,
                    range: getRange(textDocument, type.range!)
                })) {
                    return;
                }
            }
        }
    }
}

export function mustSpecifyPartyHP({ diagnostics, textDocument, document, options }: LinterInput): void {
    const wip = document.get('wip');

    if ((wip == null || wip === false) && !document.has('party_hp')) {
        addDiagnostic(diagnostics, options, {
            code: 'missing-party-hp',
            severity: DiagnosticSeverity.Error,
            message: `Field 'party_hp' is required in non-work-in-progress timelines.`,
            range: { start: textDocument.positionAt(0), end: textDocument.positionAt(1) }
        });
    }
}

export function mustHaveAtLeastOneAuthor({ diagnostics, textDocument, document, options }: LinterInput): void {
    const by = getEntry(document.contents as yaml.YAMLMap, 'by');

    if (by != null && ((yaml.isSeq(by.value) && !by.value.items.some(x => !yaml.isMap(x) || x.get('role') === 'author')) || yaml.isMap(by.value) && by.value.get('role') !== 'author')) {
        addDiagnostic(diagnostics, options, {
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

export function idMustBeValid({ diagnostics, textDocument, document, options }: LinterInput): void {
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
            if (!addDiagnostic(diagnostics, options, {
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
            })) {
                return;
            }
        }
    }
}

export function mustNotHaveRecursiveChildren({ diagnostics, textDocument, document, options }: LinterInput): void {
    const graph: yaml.Scalar[] = [];
    const recursiveGraphs: string[] = [];

    const actions = document.get('actions');

    if (actions != null && yaml.isMap(actions)) {
        for (const item of actions.items) {
            checkAction(item);
        }
    }

    function checkAction(action: yaml.Pair): void {
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

                if (!addDiagnostic(diagnostics, options, {
                    code: 'recursion',
                    severity: DiagnosticSeverity.Error,
                    message: `This child is contained in itself: ${recursiveGraph}`,
                    range: getRange(textDocument, id.range!),
                    relatedInformation: graph.map(x => ({
                        location: { uri: textDocument.uri, range: getRange(textDocument, x.range!) },
                        message: `This action is part of the recursion graph.`
                    }))
                })) {
                    recursiveGraphs.push(recursiveGraph);
                    return;
                }
                recursiveGraphs.push(recursiveGraph);
                continue;
            }

            const childAction = (actions as yaml.YAMLMap).items.find(x => yaml.isScalar(x.key) && x.key.value === id.value);

            if (childAction != null) {
                checkAction(childAction);
            }
        }

        graph.pop();
    }
}

export function validateTimeline({ diagnostics, textDocument, document, options }: LinterInput): void {
    const timeline = getIfType(document, 'timeline', yaml.isSeq);

    if (timeline != null) {
        validateTimelineItems(timeline, textDocument, document, diagnostics, options);
    }
}

const SPECIAL_ELEMENT_KEYS = [
    'players',
    'DPS',
    'tanks',
    'healers',
    'supports',
    'T1',
    'T2',
    'H1',
    'H2',
    'M1',
    'M2',
    'R1',
    'R2',
    'boss',
    'arena',
    'enemy',
    'cast',
    'tower',
    'marker-a',
    'marker-1',
    'marker-b',
    'marker-2',
    'marker-c',
    'marker-3',
    'marker-d',
    'marker-4',
];
const KEY_REGEX = /([^#]+)(?:#(?:(?:(\d+)\.\.(\d+))|(.+)))?/;
const SUBKEY_REGEX = /\[([^[\]]+)\]/g;
const RANGE_REGEX = /(?:(\d+)\.\.(\d+))/;

interface KeyResolverResult {
    definition?: string;
    elements: string[];
    wildcard: boolean;
}

function resolveKey(key: string, elements: Set<string>): KeyResolverResult {
    if (SPECIAL_ELEMENT_KEYS.includes(key)) {
        return { definition: key, elements: unwrapSpecialKey(key), wildcard: false };
    }

    const match = KEY_REGEX.exec(key);

    if (match == null || match.index !== 0 || match[0].length !== key.length) {
        throw new Error(`"${key}" is not a valid diagram key.`);
    }

    const [_, elementKey, rangeStart, rangeEnd, subkey] = match as unknown as [string, string, string | undefined, string | undefined, string | undefined];
    const result: KeyResolverResult = { definition: elementKey, elements: [], wildcard: false };

    if (rangeStart != null && rangeEnd != null) {
        for (const i of parseRangeExpression(rangeStart, rangeEnd)) {
            result.elements.push(`${elementKey}#${i}`);
        }
    } else if (subkey != null) {
        const wildcardElements = accumulateWildcardElements(subkey, elementKey, elements);

        if (wildcardElements != null) {
            result.wildcard = true;
            result.elements.push(...wildcardElements);
        } else {
            result.elements.push(...accumulateBrackets(subkey, elementKey));
        }
    } else {
        if (key[0] === '[' && key[key.length - 1] === ']') {
            key = key.slice(1, -1);
            result.definition = undefined;
        }

        const values = key.split(',');

        for (const value of values) {
            result.elements.push(value.trim());
        }
    }

    return result;
}

function unwrapSpecialKey(key: string): string[] {
    switch (key) {
        case 'players': return ['T1', 'T2', 'H1', 'H2', 'M1', 'M2', 'R1', 'R2'];
        case 'DPS': return ['M1', 'M2', 'R1', 'R2'];
        case 'tanks': return ['T1', 'T2'];
        case 'healers': return ['H1', 'H2'];
        case 'supports': return ['T1', 'T2', 'H1', 'H2'];
        default: return [key];
    }
}

function* parseRangeExpression(from: string, to: string): Generator<number> {
    const rangeStart = Number.parseInt(from);
    const rangeEnd = Number.parseInt(to);

    if (rangeStart >= rangeEnd) {
        throw new Error(`Invalid range ${from}..${to}: end must be greater than start.`);
    }

    for (let i: number = rangeStart; i <= rangeEnd; i++) {
        yield i;
    }
}

function accumulateWildcardElements(subkey: string, elementKey: string, elements: Set<string>): string[] | null {
    const wildcardIndex = subkey.indexOf('*');

    if (wildcardIndex !== -1) {
        // Wildcard pattern match
        const leftKey = `${elementKey}#${subkey.slice(0, wildcardIndex)}`;
        const rightKey = subkey.slice(wildcardIndex + 1);
        const foundElements: string[] = [];

        for (const innerElementKey in elements) {
            if (innerElementKey.startsWith(leftKey) && innerElementKey.endsWith(rightKey)) {
                foundElements.push(innerElementKey);
            }
        }

        return foundElements;
    }

    return null;
}

function* accumulateBrackets(subkey: string, elementKey: string): Generator<string> {
    let strings: string[] = [elementKey + '#'];
    let lastIndex = 0;

    for (const match of subkey.matchAll(SUBKEY_REGEX)) {
        const prefix = subkey.slice(lastIndex, match.index);
        const rangeMatch = RANGE_REGEX.exec(match[1]!);

        if (rangeMatch != null) {
            const numbers = Array.from(parseRangeExpression(rangeMatch[1]!, rangeMatch[2]!));
            strings = strings.flatMap(string => numbers.map(element => string + prefix + element));
        } else {
            const split = match[1]!.split(',');

            if (split.length === 0) {
                throw new Error(`Bracket expression [] is missing contents: ${match[0]}`);
            }

            strings = strings.flatMap(string => split.map(element => string + prefix + element.trim()));
        }

        lastIndex = match.index! + match[0].length;
    }

    const suffix = subkey.slice(lastIndex);

    for (let j: number = 0; j < strings.length; j++) {
        strings[j] += suffix;

        yield strings[j];
    }
}

export function validateGraphingItems({ diagnostics, textDocument, document, options }: LinterInput): void {
    const graphing = getIfType(document, 'graphing', yaml.isMap);

    if (graphing != null) {
        const elements = getIfType(graphing, 'elements', yaml.isMap);
        const graphs = getIfType(graphing, 'graphs', yaml.isMap);
        
        if (elements != null && graphs != null) {
            const resolvedElements = new Set<string>();

            for (const item of elements.items) {
                if (yaml.isScalar(item.key) && typeof item.key.value === 'string') {
                    resolvedElements.add(item.key.value);
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
                                    if (!addDiagnostic(diagnostics, options, {
                                        code: 'graphing-error',
                                        severity: DiagnosticSeverity.Error,
                                        message: (e as Error).message,
                                        range: getRange(textDocument, (item.key as yaml.Node).range!)
                                    })) {
                                        return;
                                    }

                                    continue;
                                }

                                if (result.wildcard && first) {
                                    if (!addDiagnostic(diagnostics, options, {
                                        code: 'first-step-wildcard',
                                        severity: DiagnosticSeverity.Error,
                                        message: 'Wildcards in element identifiers may only be used in step 2 and onwards.',
                                        range: getRange(textDocument, (item.key as yaml.Node).range!)
                                    })) {
                                        return;
                                    }
                                }

                                const definitions = result.definition != null ? [result.definition] : result.elements;

                                for (const definition of definitions) {
                                    if (!resolvedElements.has(definition) && !SPECIAL_ELEMENT_KEYS.includes(definition)) {
                                        if (!addDiagnostic(diagnostics, options, {
                                            code: 'unresolved-graphing-element',
                                            severity: DiagnosticSeverity.Error,
                                            message: `Failed to resolve '${definition}'. Did you remember to add the element definition to 'elements'?`,
                                            range: getRange(textDocument, (item.key as yaml.Node).range!)
                                        })) {
                                            return;
                                        }
                                    }
                                }

                                for (const element of result.elements) {
                                    if (first) {
                                        firstStepElements.add(element);
                                    } else if (!firstStepElements.has(element)) {
                                        if (!addDiagnostic(diagnostics, options, {
                                            code: 'uninitialized-graphing-element',
                                            severity: DiagnosticSeverity.Error,
                                            message: `Found uninitialized element '${element}'. All elements must be initialized in the first step of a graph.`,
                                            range: getRange(textDocument, (item.key as yaml.Node).range!)
                                        })) {
                                            return;
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
