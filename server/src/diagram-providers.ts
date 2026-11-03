// The language features of `.diagram` files other than diagnostics.
import { CompletionItem, CompletionItemKind, CompletionParams, DefinitionLink, DefinitionParams, Hover, HoverParams, InlayHint, InlayHintParams, Location, Position, Range, ReferenceParams, TextDocuments, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { baseOf, DiagramToken, fieldsOf, idsOf, linesOf, liveIdsOf, occurrencesOf, timelineOf, Timeline, tokensOf, usesOfTimeline } from './diagram-context';
import { ParserCache } from './parser-cache';
import { RESOLVE_PRESETS } from './components/diagram/render/effects/presets';
import { ThaliakTimelineLinterSettings } from './server';
import { actionTooltip, getStatusIcon, statusTooltip, type TooltipContext } from './tooltip';
import { DiagramDefineKind, DiagramField, DiagramSchema, valuesOf } from './types/diagram-schema';
import { OutlineNode, OutlineParams, StatusIcon } from './types/outline';
import { UnprocessedRaidData } from './types/raids';
import { Definition, parse, tokenize } from './utility/diagram-ddl/parse';
import { formatTime, getAction, getRange, getStatus, getStrategyKeys } from './util';

const PLAYERS = ['T1', 'T2', 'H1', 'H2', 'M1', 'M2', 'R1', 'R2'];

/** The placeholders that stand for groups of players: all of them but the subject's sub-ID. */
function groupsOf(schema: DiagramSchema | undefined): string[] {
    return Object.keys(schema?.placeholders ?? {}).filter(placeholder => placeholder !== '<id>');
}

/** The first line of the `define` block that `line` is inside of, or -1 if it's in none. */
function blockOf(lines: string[], line: number, text: string = lines[line] ?? ''): number {
    if (!/^\s/.test(text)) {
        return -1;
    }

    let block = line - 1;

    while (block >= 0 && (lines[block]!.trim() === '' || /^\s/.test(lines[block]!))) {
        block--;
    }

    return block;
}

function items(labels: Iterable<string>, kind: CompletionItemKind, edit: (label: string) => TextEdit, sortPrefix: string = 'a', describe?: (label: string) => string | undefined): CompletionItem[] {
    return Array.from(labels, label => {
        const documentation = describe?.(label);

        return { label, kind, sortText: `${sortPrefix}${label}`, textEdit: edit(label), ...(documentation != null ? { documentation: { kind: 'markdown', value: documentation } } : {}) } as CompletionItem;
    });
}

/** The keys of `section`, a map at the top level of the timeline. */
function keysOf(timeline: Timeline | null, section: 'actions' | 'status'): string[] {
    return Object.keys(timeline?.js[section] ?? {});
}

/** Reads where an argument list stands at its end: which clause is being written, and whether a value or a clause's name comes next. */
function argumentStateOf(text: string): { clause?: string, expectValue: boolean } {
    const tokens = tokenize(text);
    let clause: string | undefined;
    let expectValue = true;

    // The last word is still being written, unless a space or comma ended it.
    if (tokens.length > 0 && !/[\s,]$/.test(text)) {
        tokens.pop();
    }

    for (const token of tokens) {
        if (token === ',') {
            expectValue = true;
        } else if (expectValue) {
            expectValue = false;
        } else {
            clause = token;
            expectValue = true;
        }
    }

    return { clause, expectValue };
}

/** Code completion in `.diagram` files. */
export function diagramCompletionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: CompletionParams) => CompletionItem[] {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri);

        if (textDocument == null) {
            return [];
        }

        const source = textDocument.getText();
        const parsed = parse(source);
        const lines = linesOf(source);
        const { line, character } = params.position;
        const before = (lines[line] ?? '').slice(0, character);
        // A word can hold everything but what separates words.
        const wordStart = before.search(/[^\s,:]*$/);
        const edit = (label: string) => TextEdit.replace({ start: { line, character: wordStart }, end: params.position }, label);
        const timeline = timelineOf(documents, textDocument.uri);
        const elementDefinitions = parsed.definitions.filter(definition => definition.kind === 'element').map(definition => definition.id);
        const strategies = parsed.definitions.filter(definition => definition.kind === 'strategy').map(definition => definition.id);
        const schema = documentCache.getLinterOptions(settings).diagramSchema;
        const groups = groupsOf(schema);
        const verbsOfSchema = schema?.verbs ?? {};
        /** The verbs that stand on their own, without a colon or arguments. */
        const isBareVerb = (verb: string) => verbsOfSchema[verb] != null && verbsOfSchema[verb]!.arguments == null;
        const keyword = (labels: Iterable<string>, describe?: (label: string) => string | undefined) => items(labels, CompletionItemKind.Keyword, edit, undefined, describe);
        const member = (labels: Iterable<string>, prefix?: string, describe?: (label: string) => string | undefined) => items(labels, CompletionItemKind.EnumMember, edit, prefix, describe);

        // The header of a `define` block.
        if (/^define\s+\S*$/.test(before)) {
            return keyword(['element', 'action', 'gradient', 'strategy'], label => schema?.define[label as Definition['kind']].description);
        }

        if (/^define\s+action\s+\S*$/.test(before)) {
            return member(keysOf(timeline, 'actions'));
        }

        // The ID of anything else is new, so there's nothing to suggest.
        if (/^define\s+\S+\s+\S*$/.test(before)) {
            return [];
        }

        // Inside a `define` block, which runs until the next line in the first column.
        const block = blockOf(lines, line, before);
        const definition = block >= 0 ? parsed.definitions.find(x => x.line - 1 === block) : undefined;

        if (definition != null) {
            const field = /^\s+([a-zA-Z][\w-]*):\s*(.*)$/.exec(before);

            if (definition.kind === 'gradient') {
                return [];
            }

            if (field == null) {
                // Without a colon yet, it's a key, unless the line continues `exit`.
                if (schema == null) {
                    return [];
                }

                const known = fieldsOfKind(schema, definition.kind);

                return keyword(Object.keys(known), label => known[label]?.description);
            }

            const spec = schema != null ? fieldsOfKind(schema, definition.kind)[field[1]!] : undefined;

            switch (field[1]) {
                case 'telegraph':
                case 'flash': return member(elementDefinitions);
                case 'use': return member(liveIdsOf(tokensOf(source, parsed)));
                case 'covers': return member(timeline != null ? getStrategyKeys(timeline.document) : []);
                case 'exit': {
                    const values = spec != null ? valuesOf(schema!, spec) : {};

                    return [...keyword(['+effect', '-actor', '+actor', '+marker', '-marker', '+status', '-status'], label => schema?.verbs[label]?.description), ...member(Object.keys(values), 'b', label => values[label])];
                }
                default: {
                    const values = spec != null ? valuesOf(schema!, spec) : {};

                    return member(Object.keys(values), undefined, label => values[label]);
                }
            }
        }

        const rest = before.replace(/^\s*(?:\d+\s+)?/, '');
        const verbOnLine = /^([+-]?)([a-z][a-z-]*):\s*(.*)$/.exec(rest);
        let sign: string;
        let verb: string;
        let args: string;

        if (verbOnLine != null) {
            [, sign, verb, args] = verbOnLine as unknown as [string, string, string, string];
        } else {
            const active = parsed.statements.findLast(statement => statement.line - 1 < line);
            const isContinuation = /^\s/.test(before) && active != null && !isBareVerb(`${active.sign}${active.verb}`) && !/^\d/.test(before.trim());
            const isOneWord = !/\s/.test(rest);
            const verbs = isOneWord ? items(Object.keys(verbsOfSchema), CompletionItemKind.Keyword, label => edit(isBareVerb(label) ? label : `${label}: `), 'z', label => verbsOfSchema[label]?.description) : [];

            if (!isContinuation) {
                return [...verbs, ...(before === '' || /^define?$/.test(before) || /^[a-z]+$/.test(before) ? keyword(['define'], () => schema?.define.description) : [])];
            }

            sign = active!.sign;
            verb = active!.verb;
            args = rest;

            return [...verbs, ...argumentsCompletion()];
        }

        return argumentsCompletion();

        function argumentsCompletion(): CompletionItem[] {
            const { clause, expectValue } = argumentStateOf(args);

            if (!expectValue) {
                return keyword(verbsOfSchema[`${sign}${verb}`]?.clauses ?? [], label => schema?.clauses[label]?.description);
            }

            if (clause != null) {
                if (schema?.clauses[clause]?.takes !== 'element') {
                    return [];
                }

                // Only players have status effects.
                if (verb === 'status') {
                    return member([...PLAYERS, ...groups], undefined, label => schema.placeholders[label]);
                }

                return [
                    ...member(liveIdsOf(tokensOf(source, parsed))),
                    ...member(['<id>', ...PLAYERS, ...groups], 'b', label => schema.placeholders[label])
                ];
            }

            switch (verb) {
                case 'aoe':
                    return member(keysOf(timeline, 'actions'));
                case 'status':
                    return member(new Set([...keysOf(timeline, 'status'), ...Object.keys(documentCache.getLinterOptions(settings).enums.common?.yaml.status ?? {})]));
                case 'effect':
                    return member(RESOLVE_PRESETS as readonly string[], undefined, label => schema?.animations.exit[label]);
                case 'strategy':
                    return member(strategies);
                case 'thumbnail':
                    return member(timeline != null ? getStrategyKeys(timeline.document) : []);
                case 'actor':
                case 'marker':
                case 'tether':
                    if (sign === '+') {
                        return member(elementDefinitions);
                    }
                // falls through
                case 'depart':
                case 'arrive':
                case 'set':
                    return [...member(liveIdsOf(tokensOf(source, parsed))), ...member([...PLAYERS, ...groups], 'b', label => schema?.placeholders[label])];
                default:
                    return [];
            }
        }
    };
}

/** The fields a `define` block of `kind` can have. Only an action's has the action fields. */
function fieldsOfKind(schema: DiagramSchema, kind: Definition['kind']): DiagramDefineKind['fields'] {
    switch (kind) {
        case 'gradient': return {};
        case 'strategy': return schema.define.strategy.fields;
        case 'action': return { ...schema.define.action.fields, ...schema.define.element.fields };
        case 'element': return schema.define.element.fields;
    }
}

/** A field's tooltip: its name and what it does. */
function describeField(key: string, field: DiagramField): string {
    return `**${key}**\n\n${field.description}`;
}

/** The word at `character` in `text`, as far as it's a name, a sign included. */
function wordAt(text: string, character: number): { word: string, start: number, end: number } | null {
    for (const match of text.matchAll(/[+-]?[A-Za-z][\w-]*|<[^>\s]+>|\d+/g)) {
        if (character >= match.index && character <= match.index + match[0].length) {
            return { word: match[0], start: match.index, end: match.index + match[0].length };
        }
    }

    return null;
}

/** Tooltips in `.diagram` files: what each word of the language means, from the schema, and what each name in the file stands for. */
export function diagramHoverProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: HoverParams) => Promise<Hover | null> {
    return async (params) => {
        const textDocument = documents.get(params.textDocument.uri);
        const options = documentCache.getLinterOptions(settings);
        const schema = options.diagramSchema;

        if (textDocument == null || schema == null) {
            return null;
        }

        const source = textDocument.getText();
        const parsed = parse(source);
        const lines = linesOf(source);
        const { line, character } = params.position;
        const text = lines[line] ?? '';
        const found = wordAt(text, character);

        if (found == null) {
            return null;
        }

        const { word, start, end } = found;
        const hover = (value: string | null | undefined): Hover | null => value != null ? { contents: { kind: 'markdown', value }, range: { start: { line, character: start }, end: { line, character: end } } } : null;
        const timeline = timelineOf(documents, textDocument.uri);
        const isAction = (key: string) => timeline?.js.actions?.[key] != null;
        const context: TooltipContext = { raid: timeline?.js as UnprocessedRaidData | null ?? null, enums: options.enums };

        /** What a `define` block of `id` says, as written. */
        const definedAs = (id: string) => {
            const definition = parsed.definitions.find(x => x.id === id);

            return definition != null ? `\`\`\`thaliak-diagram\n${lines.slice(definition.line - 1, (fieldsOf(definition, lines).at(-1)?.line ?? definition.line - 1) + 1).join('\n')}\n\`\`\`` : null;
        };

        /** What a name in a statement stands for. */
        const named = async (id: string, verb: string | undefined, kind: string | undefined) => {
            if (verb === 'status' && kind === 'subject') {
                return statusTooltip(context, id.replace(/:\d+$/, ''));
            }

            if (verb === 'effect' && kind === 'subject') {
                return schema.animations.exit[id] != null ? `**${id}**\n\n${schema.animations.exit[id]}` : null;
            }

            const base = baseOf(idsOf(id)[0]!);

            if (PLAYERS.includes(id)) {
                return `**${id}**\n\nA player.`;
            }

            if (isAction(base)) {
                return [await actionTooltip(context, base), definedAs(base)].filter(part => part != null).join('\n\n') || null;
            }

            return definedAs(base);
        };

        // The `define` line itself.
        if (/^define\b/.test(text)) {
            const definition = parsed.definitions.find(x => x.line - 1 === line);

            if (word === 'define') return hover(`**define**\n\n${schema.define.description}`);
            if (definition != null && word === definition.kind) return hover(`**define ${word}**\n\n${schema.define[definition.kind].description}`);

            return definition?.kind === 'action' && isAction(definition.id) ? hover(await actionTooltip(context, definition.id)) : null;
        }

        const token = tokensOf(source, parsed).find(x => x.line === line && character >= x.start && character <= x.end);
        const block = blockOf(lines, line);
        const definition = block >= 0 ? parsed.definitions.find(x => x.line - 1 === block) : undefined;

        // What runs under `exit` reads like a statement, also on the line of the key itself.
        if (definition != null && (token?.statement != null || schema.verbs[word] != null && text[end] === ':')) {
            return schema.verbs[word] != null && text[end] === ':' ? hover(`**${word}**\n\n${schema.verbs[word]!.description}`) : hover(await named(token!.text, token!.statement?.verb, token!.kind));
        }

        if (definition != null && !/^\s*[+-][a-z]/.test(text)) {
            const fields = fieldsOf(definition, lines);
            const field = fields.findLast(x => x.line <= line);
            const known = fieldsOfKind(schema, definition.kind);

            if (field == null) {
                return null;
            }

            // A key, at the start of the line or inside a value such as `{ type: plain }`.
            if (text[end] === ':') {
                const spec = known[word];

                return spec != null ? hover(describeField(word, spec)) : null;
            }

            if (token?.kind === 'field') {
                return hover(await named(token.text, undefined, 'field'));
            }

            const spec = known[field.key];
            const values: Record<string, string> = spec != null ? valuesOf(schema, spec) : {};
            const description = values[word] ?? (field.key === 'flashLook' ? { ...valuesOf(schema, known.look!), ...valuesOf(schema, known.enter!), ...valuesOf(schema, known.exit!) }[word] : undefined);

            return description != null ? hover(`**${word}**\n\n${description}`) : null;
        }

        // The time at the start of a line.
        if (start === 0 && /^\d+$/.test(word)) {
            return hover(`**${formatTime(Number(word))}**`);
        }

        // A verb: the line's first word after its time, or the start of a statement under `exit`.
        const statementStart = /^\s*(?:\d+\s+)?(?:[a-zA-Z][\w-]*:\s*)?/.exec(text)?.[0].length ?? 0;
        const verb = schema.verbs[word];

        if (verb != null && (start === (/^\s*(?:\d+\s+)?/.exec(text)?.[0].length ?? 0) || start === statementStart)) {
            return hover(`**${word}**\n\n${verb.description}`);
        }

        if (schema.placeholders[word] != null) {
            return hover(`**${word}**\n\n${schema.placeholders[word]}`);
        }

        if (token != null) {
            return hover(await named(token.text, token.statement?.verb, token.kind));
        }

        if (schema.clauses[word] != null) {
            return hover(`**${word}**\n\n${schema.clauses[word]!.description}`);
        }

        // Anything else in a clause's place is a property of the element, such as `size 50`.
        const property = schema.define.element.fields[word];

        return property != null ? hover(describeField(word, property)) : null;
    };
}

/** How far from a timeline action a `.diagram` time still counts as near it, in ms. */
const NEAR_ACTION = 1000;

/** Shows, at the end of each line with a time in a `.diagram` file, the time as `m:ss.mmm` and the timeline actions nearest to it. */
export function diagramInlayHintProvider(documents: TextDocuments<TextDocument>): (params: InlayHintParams) => InlayHint[] {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri);

        if (textDocument == null) {
            return [];
        }

        const timeline = timelineOf(documents, textDocument.uri);
        const uses = timeline != null ? usesOfTimeline(timeline) : [];
        const lines = textDocument.getText().split(/\r?\n/);
        const hints: InlayHint[] = [];

        for (let line = params.range.start.line; line <= params.range.end.line && line < lines.length; line++) {
            const time = /^\d+/.exec(lines[line]!)?.[0];

            if (time == null) {
                continue;
            }

            const at = Number(time);
            const nearest = uses.reduce((best, use) => Math.min(best, Math.abs(use.at - at)), Infinity);
            const near = nearest <= NEAR_ACTION ? [...new Set(uses.filter(use => Math.abs(use.at - at) === nearest).map(use => {
                const offset = at - use.at;

                return offset === 0 ? use.action : `${use.action} ${offset > 0 ? '+' : ''}${offset}`;
            }))] : [];

            // At the end of the line: anywhere earlier, a hint pushes the file's aligned columns apart.
            hints.push({
                position: { line, character: lines[line]!.length },
                label: [formatTime(at), ...near].join(' '),
                paddingLeft: true
            });
        }

        return hints;
    };
}

function tokenAt(tokens: DiagramToken[], position: Position): DiagramToken | undefined {
    return tokens.find(token => token.line === position.line && position.character >= token.start && position.character <= token.end);
}

function linkTo(origin: DiagramToken, textDocument: TextDocument, target: yaml.Pair<yaml.Scalar<string>, yaml.Node<unknown>>): DefinitionLink {
    return {
        originSelectionRange: { start: { line: origin.line, character: origin.start }, end: { line: origin.line, character: origin.end } },
        targetUri: textDocument.uri,
        targetRange: getRange(textDocument, [target.key.range![0], ...target.value!.range!.slice(1)] as yaml.Range),
        targetSelectionRange: getRange(textDocument, target.key.range!)
    };
}

/** Go to Definition in `.diagram` files: statuses and actions go to the timeline, and other IDs to their `define` block. */
export function diagramDefinitionProvider(documents: TextDocuments<TextDocument>): (params: DefinitionParams) => DefinitionLink[] | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri);

        if (textDocument == null) {
            return null;
        }

        const source = textDocument.getText();
        const parsed = parse(source);
        const token = tokenAt(tokensOf(source, parsed), params.position);

        if (token == null) {
            return null;
        }

        const timeline = timelineOf(documents, textDocument.uri);

        if (token.statement?.verb === 'status') {
            const status = token.kind === 'subject' && timeline != null ? getStatus(timeline.document, token.text.replace(/:\d+$/, '')) : null;

            return status != null ? [linkTo(token, timeline!.textDocument, status)] : null;
        }

        const base = baseOf(idsOf(token.text)[0]!);
        const namesAction = token.statement?.verb === 'aoe' || (token.kind === 'definition' && parsed.definitions.some(x => x.kind === 'action' && x.line - 1 === token.line));
        const action = namesAction && timeline != null ? getAction(timeline.document, base) : null;

        if (action != null) {
            return [linkTo(token, timeline!.textDocument, action)];
        }

        const definition = parsed.definitions.find(x => x.id === base);

        if (definition == null) {
            return null;
        }

        const line = definition.line - 1;
        const range: Range = { start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } };

        return [{
            originSelectionRange: { start: { line: token.line, character: token.start }, end: { line: token.line, character: token.end } },
            targetUri: textDocument.uri,
            targetRange: range,
            targetSelectionRange: range
        }];
    };
}

/**
 * Find All References in `.diagram` files. On a `define` block or a bare definition's ID, every element of that
 * definition; on an instance (`boss#eye`), that one. Actions and statuses also list their timeline key.
 */
export function diagramReferenceProvider(documents: TextDocuments<TextDocument>): (params: ReferenceParams) => Location[] | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri);

        if (textDocument == null) {
            return null;
        }

        const uri = textDocument.uri;
        const tokens = tokensOf(textDocument.getText());
        const token = tokenAt(tokens, params.position);

        if (token == null) {
            return null;
        }

        const timeline = timelineOf(documents, uri);

        if (token.statement?.verb === 'status') {
            const key = token.text.replace(/:\d+$/, '');
            const status = timeline != null ? getStatus(timeline.document, key) : null;

            return [
                ...occurrencesOf(textDocument, 'status', key).map(range => ({ uri, range })),
                ...(status != null ? [{ uri: timeline!.textDocument.uri, range: getRange(timeline!.textDocument, status.key.range!) }] : [])
            ];
        }

        const ids = idsOf(token.text);
        const isDefinition = ids.every(id => !id.includes('#'));
        const bases = new Set(ids.map(baseOf));
        const matches = (other: DiagramToken) => idsOf(other.text).some(id => isDefinition ? bases.has(baseOf(id)) : ids.includes(id));
        const locations: Location[] = tokens
            .filter(other => other.statement?.verb !== 'status' && other.statement?.verb !== 'effect' && matches(other))
            .map(other => ({ uri, range: { start: { line: other.line, character: other.start }, end: { line: other.line, character: other.end } } }));

        for (const base of bases) {
            const action = timeline != null ? getAction(timeline.document, base) : null;

            if (action != null) {
                locations.push({ uri: timeline!.textDocument.uri, range: getRange(timeline!.textDocument, action.key.range!) });
            }
        }

        return locations;
    };
}

/** The in-game icons in front of the status effects of a `.diagram` file's `+status` and `-status` statements. */
export function diagramStatusIconProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: OutlineParams) => Promise<StatusIcon[] | null> {
    return async (params) => {
        const textDocument = documents.get(params.uri);

        if (textDocument == null) {
            return null;
        }

        const timeline = timelineOf(documents, textDocument.uri);
        const common = documentCache.getLinterOptions(settings).enums.common;
        const icons = tokensOf(textDocument.getText())
            .filter(token => token.statement?.verb === 'status' && token.kind === 'subject')
            .map(async (token): Promise<StatusIcon | null> => {
                const [, key, stacks] = /^(.*?)(?::(\d+))?$/.exec(token.text)!;
                const definition = timeline != null ? getStatus(timeline.document, key!)?.value : null;
                const id = yaml.isMap(definition) ? definition.get('id') : common?.yaml.status[key!];

                if (typeof id !== 'number') {
                    return null;
                }

                const icon = await getStatusIcon(id, yaml.isMap(definition) ? definition.get('icon') : undefined, stacks != null ? Number.parseInt(stacks) : 1);
                const position = { line: token.line, character: token.start };

                return icon != null ? { range: { start: position, end: position }, path: icon.path } : null;
            });

        return (await Promise.all(icons)).filter(icon => icon != null);
    };
}

/** The timeline tree view of a `.diagram` file: its `define` blocks, then its keyframes with their first hint. */
export function diagramOutlineProvider(documents: TextDocuments<TextDocument>): (params: OutlineParams) => OutlineNode[] | null {
    return (params) => {
        const textDocument = documents.get(params.uri);

        if (textDocument == null) {
            return null;
        }

        const source = textDocument.getText();
        const parsed = parse(source);
        const lines = linesOf(source);
        const lineRange = (first: number, last: number): Range => ({ start: { line: first, character: 0 }, end: { line: last, character: Number.MAX_SAFE_INTEGER } });
        const section = (name: string, children: OutlineNode[]): OutlineNode => ({
            label: name,
            icon: { kind: 'section', name },
            range: lineRange(children[0]?.range.start.line ?? 0, children.at(-1)?.range.end.line ?? 0),
            selection: children[0]?.selection ?? lineRange(0, 0),
            children
        });
        const definitions = parsed.definitions.map(definition => {
            const fields = fieldsOf(definition, lines);
            const text = (key: string) => fields.find(field => field.key === key)?.value;
            const look = text('look');
            const line = definition.line - 1;

            return {
                label: definition.id,
                description: definition.kind !== 'element' ? definition.kind : look,
                icon: { kind: 'element', key: definition.id, type: text('type'), look },
                range: lineRange(line, fields.at(-1)?.line ?? line),
                selection: lineRange(line, line),
                references: { line, character: lines[line]!.lastIndexOf(definition.id) }
            } satisfies OutlineNode;
        });
        const keyframes = parsed.statements.filter(statement => statement.verb === 'keyframe');
        const keyframeNodes = keyframes.map((keyframe, i) => {
            const next = keyframes[i + 1];
            const hint = parsed.statements.find(statement => statement.verb === 'hint' && statement.sign === '+' && statement.at === keyframe.at);
            const line = keyframe.line - 1;

            return {
                label: formatTime(keyframe.at),
                description: hint?.text,
                icon: { kind: 'keyframe' },
                range: lineRange(line, (next?.line ?? lines.length) - 1),
                selection: lineRange(line, line)
            } satisfies OutlineNode;
        });

        return [
            ...(definitions.length > 0 ? [section('elements', definitions)] : []),
            ...(keyframeNodes.length > 0 ? [section('timeline', keyframeNodes)] : [])
        ];
    };
}
