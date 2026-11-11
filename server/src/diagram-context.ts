// What the `.diagram` providers share: finding a `.diagram` file's timeline and the other way around,
// the facts about its actions as thaliak's build gets them, and where each word of the file is.
import * as fs from 'fs';
import * as paths from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from 'image-size';
import { Range, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { castTimeOf, getGameAction } from './ironworks';
import { hitboxRadius, paddedEffectRange } from './tooltip';
import { ActionFacts, arenaImagesOf, arenasOf, DiagramInput, expandTemplate, RawItem, usesOf, variantIdsOf } from './utility/diagram-ddl/compile';
import { Definition, parse, ParseResult, Statement, tokenize } from './utility/diagram-ddl/parse';

export const DIAGRAM_LANGUAGE = 'thaliak-diagram';

/** Whether the document is a `.diagram` file. */
export function isDiagramUri(uri: string): boolean {
    return uri.endsWith('.diagram');
}

/** The document with the same name as `uri` and the given extension: open, or else read from disk. `null` if there's none. */
function siblingDocument(documents: TextDocuments<TextDocument>, uri: string, extension: '.yaml' | '.diagram'): TextDocument | null {
    const target = uri.replace(/\.[^./]+$/, extension);
    const open = documents.get(target);

    if (open != null) {
        return open;
    }

    try {
        return TextDocument.create(target, extension === '.yaml' ? 'yaml' : DIAGRAM_LANGUAGE, 0, fs.readFileSync(fileURLToPath(target), 'utf-8'));
    } catch {
        return null;
    }
}

/** The `.diagram` file next to the timeline `uri`, or `null` if it has none. */
export function diagramOf(documents: TextDocuments<TextDocument>, uri: string): TextDocument | null {
    return uri.endsWith('.yaml') ? siblingDocument(documents, uri, '.diagram') : null;
}

/** A `.diagram` file's timeline. */
export interface Timeline {
    textDocument: TextDocument;
    document: yaml.Document;
    /** `document` as plain JavaScript. */
    js: Record<string, any>;
}

/** The last timeline read. Converting one is slow, and only the file being edited is asked for over and over. */
let lastTimeline: { text: string, timeline: Timeline | null } | null = null;

/** The timeline next to the `.diagram` file `uri`, or `null` if it has none or it can't be read as a timeline. */
export function timelineOf(documents: TextDocuments<TextDocument>, uri: string): Timeline | null {
    const textDocument = siblingDocument(documents, uri, '.yaml');

    if (textDocument == null) {
        return null;
    }

    const text = textDocument.getText();

    if (lastTimeline?.text !== text || lastTimeline.timeline?.textDocument.uri !== textDocument.uri) {
        lastTimeline = { text, timeline: readTimeline(textDocument, text) };
    }

    return lastTimeline.timeline;
}

function readTimeline(textDocument: TextDocument, text: string): Timeline | null {
    // Its `errors` don't count: this parser reports some valid flow-style keys as errors, and still reads them.
    const document = yaml.parseDocument(text);

    if (!yaml.isMap(document.contents)) {
        return null;
    }

    return { textDocument, document, js: document.toJS() as Record<string, any> };
}

/** Whether the timeline holds diagram errors back, which thaliak's build then doesn't report. */
export function isDiagramWip(timeline: Timeline): boolean {
    const wip = timeline.js.wip;

    return wip === 'full' || (Array.isArray(wip) && wip.includes('diagrams'));
}

/** The uses of the timeline's actions, in time order. */
export function usesOfTimeline(timeline: Timeline): ReturnType<typeof usesOf> {
    return usesOf((timeline.js.timeline ?? []) as RawItem[], (timeline.js.actions ?? {}) as Record<string, ActionFacts>).sort((a, b) => a.at - b.at);
}

/**
 * The size of the arena image `image` (a path under `www/`), looked for in `www` next to each folder above
 * the `.diagram` file, since the data repository can be open without thaliak around it. `null` if it isn't found.
 */
function arenaImageSize(diagramUri: string, image: string): [number, number] | null {
    if (!image.startsWith('/')) {
        return null;
    }

    let folder = paths.dirname(fileURLToPath(diagramUri));
    let previous: string;

    do {
        try {
            // Copied, since this @types/node's Buffer doesn't type-check as a Uint8Array under TypeScript 6.
            const { width, height } = imageSize(new Uint8Array(fs.readFileSync(paths.join(folder, 'www', image))));

            return [width, height];
        } catch {
            previous = folder;
            folder = paths.dirname(folder);
        }
    } while (folder !== previous);

    return null;
}

/**
 * What the compiler needs from a timeline, as `processAction()` in thaliak's build fills it in. Without game data,
 * actions get a size of 1 and a cast type that draws their shape, so that all they lose is the telegraph's timing rather
 * than getting a false size error. `source` is the `.diagram` file's text, whose `+aoe ... as <ID>` need game data too.
 */
export async function diagramInputOf(timeline: Timeline, diagramUri: string, source: string): Promise<{ input: DiagramInput, problems: string[] }> {
    const { js } = timeline;
    const rawActions = (js.actions ?? {}) as Record<string, ActionFacts>;
    const rawItems = (js.timeline ?? []) as RawItem[];
    const actors = (js.actors ?? {}) as NonNullable<DiagramInput['actors']>;
    const actions: Record<string, ActionFacts> = {};
    const problems: string[] = [];
    const defaultRadius = await hitboxRadius(undefined);
    // By actor key, for the actors with a BNpcBase, as thaliak's build reads them.
    const hitboxes: Record<string, number> = {};

    await Promise.all(Object.entries(actors).map(async ([key, actor]) => {
        if (actor?.id != null) hitboxes[key] = await hitboxRadius(actor.id);
    }));

    await Promise.all(Object.entries(rawActions).map(async ([key, raw]) => {
        const facts: ActionFacts = { ...raw };
        const game = raw.id != null ? await getGameAction(raw.id) : null;
        const hit = raw.hit != null ? await getGameAction(raw.hit) : null;
        // A child that is the hit makes this action only group its children, so the AoE stays the cast's.
        const hitIsChild = hit != null && (raw.children ?? []).some(child => rawActions[child.id]?.id === raw.hit);
        const aoe = hitIsChild ? game : hit ?? game;
        const firstActor = raw.actor == null ? undefined : Array.isArray(raw.actor) ? raw.actor[0] : raw.actor;

        if (game != null && aoe != null) {
            // A hit comes from a helper, so its range is padded as theirs; otherwise by the first actor's hitbox.
            facts.effectRange = paddedEffectRange(aoe, aoe === hit ? defaultRadius : hitboxes[firstActor ?? ''] ?? defaultRadius);
            facts.xAxisModifier = aoe.XAxisModifier;
            facts.hasOmen = aoe.omenPath != null;
            facts.omen = aoe.omenPath;
            facts.castType = aoe.castType;
            facts.cast = castTimeOf(game);
            facts.name ??= game.name;
        } else if (raw.id != null) {
            facts.effectRange = 1;
            facts.xAxisModifier = 1;
            // A placeholder, not the game's cast type: drawnShape() only reads it to pick how a halfroom or in-or-out is
            // drawn, and other shapes are drawn from their shape alone. 13 draws a halfroom as a half circle, which at a
            // size of 1 looks more like one than the 1x1 square of 12. 2 draws an in-or-out as a circle, and also marks
            // the action as an AoE so that an action with children isn't taken to only group them.
            facts.castType = raw.shape === 'halfroom' ? 13 : 2;
        }

        actions[key] = facts;
    }));

    // What `+aoe ... as <game action ID>` draws instead.
    const variants: Record<number, ActionFacts> = {};

    await Promise.all(variantIdsOf(source).map(async id => {
        const game = await getGameAction(id);

        if (game == null) {
            problems.push(`Couldn't read the game data of action ${id}, which a placement is drawn as.`);
            return;
        }

        variants[id] = { effectRange: paddedEffectRange(game, defaultRadius), xAxisModifier: game.XAxisModifier, castType: game.castType, hasOmen: game.omenPath != null, omen: game.omenPath };
    }));

    const arenas = arenasOf(rawItems);
    const arenaImageSizes: Record<string, [number, number]> = {};

    for (const image of arenaImagesOf(source)) {
        const size = arenaImageSize(diagramUri, image);

        if (size != null) {
            arenaImageSizes[image] = size;
        } else {
            problems.push(`Couldn't read the size of the arena image ${image}, so sizes and speeds assume the default of 5 units per yalm.`);
        }
    }

    const arena = js.arena as number | [number, number] | undefined;

    return {
        input: {
            uses: usesOf(rawItems, rawActions),
            actions,
            arenas,
            arenaImageSizes,
            arenaSize: typeof arena === 'number' ? [arena, arena] : arena,
            waymarks: js.waymarks,
            actors,
            hitboxes,
            variants
        },
        problems
    };
}

/** A `key: value` line of a `define` block, or a further line of the key before it. */
export interface DefinitionField {
    key: string;
    /** The 0-based line. */
    line: number;
    /** The column the key (or a further line's value) starts at. */
    start: number;
    value: string;
    valueStart: number;
}

/** The lines of `source`, without their `//` comments. Blanks out the comment so that columns stay right. */
export function linesOf(source: string): string[] {
    return source.split(/\r?\n/).map(line => {
        let quoted = false;

        for (let i = 0; i < line.length - 1; i++) {
            if (line[i] === '"') quoted = !quoted;
            if (!quoted && line[i] === '/' && line[i + 1] === '/') return line.slice(0, i);
        }

        return line;
    });
}

/** The fields of `definition`, read like the parser reads them. */
export function fieldsOf(definition: Definition, lines: string[]): DefinitionField[] {
    const fields: DefinitionField[] = [];
    let key: string | null = null;
    /** How far the keys are indented. A line indented deeper continues the last field, as a second hook statement does. */
    let keyIndent = Infinity;

    for (let line = definition.line; line < lines.length; line++) {
        const raw = lines[line]!;

        if (raw.trim() === '') continue;
        if (!/^\s/.test(raw)) break;

        const start = raw.length - raw.trimStart().length;
        const match = definition.kind !== 'gradient' ? /^((?:on:)?[a-zA-Z][\w-]*):(\s*)(.*)$/.exec(raw.trimStart()) : null;

        if (match != null && !(key != null && start > keyIndent)) {
            key = match[1]!;
            keyIndent = Math.min(keyIndent, start);
            fields.push({ key, line, start, value: match[3]!.trimEnd(), valueStart: start + key.length + 1 + match[2]!.length });
        } else if (key != null) {
            fields.push({ key, line, start, value: raw.trim(), valueStart: start });
        }
    }

    return fields;
}

/** A word of a `.diagram` file that can refer to something. */
export interface DiagramToken {
    text: string;
    line: number;
    start: number;
    end: number;
    /** What it is: a statement's subject, a value of a clause, the ID of a `define` block, or the value of `flash`. */
    kind: 'subject' | 'value' | 'definition' | 'field';
    /** The statement it's part of, unless it's in a `define` block's own lines. */
    statement?: Statement;
    /** The clause it's a value of. */
    clause?: string;
    /** For a `field` token, the key it's the value of. */
    field?: string;
}

/** Whether a token names a strategy (`define strategy` or `+strategy:`), whose IDs are apart from those of elements. */
export function isStrategyToken(token: DiagramToken, definitions: Definition[]): boolean {
    return token.statement?.verb === 'strategy'
        || token.kind === 'definition' && definitions.some(definition => definition.kind === 'strategy' && definition.line - 1 === token.line);
}

/** Where the arguments of a statement's line start: past the timestamp and verb. */
const LINE_PREFIX = /^\s*(?:\d+\s+)?(?:[+-]?[a-z][a-z-]*:\s*)?/;
/** The fields whose value names an element. */
const ELEMENT_FIELDS = new Set(['flash']);

/** A hook statement that starts with a clause instead of a subject (`teleport: to (0, 0)`), which moves the action's caster. */
export const SUBJECTLESS_HOOK = /^[+-]?[a-z][a-z-]*:\s+(?:to|toward|rotate|over)\b/;

/** Finds a statement's words in `raw`, its line. A `subjectless` one starts with a clause. */
function* statementTokens(statement: Statement, raw: string, line: number, subjectless: boolean = false): Generator<DiagramToken> {
    // `+strategy: <ID>` takes free text, which is the ID of a `define strategy`.
    if (statement.verb === 'strategy' && statement.sign === '+' && statement.text !== '') {
        const start = raw.indexOf(statement.text, LINE_PREFIX.exec(raw)![0].length);

        yield { text: statement.text, line, start, end: start + statement.text.length, kind: 'subject', statement };
        return;
    }

    if (statement.subjects.length === 0) {
        return;
    }

    let offset = raw.indexOf(statement.text, LINE_PREFIX.exec(raw)![0].length);
    const tokens = tokenize(statement.text);
    let index = 0;
    let clause: string | undefined;
    let expectValue = !subjectless;

    for (const text of tokens) {
        const start = raw.indexOf(text, offset);
        offset = start + text.length;
        index++;

        if (text === ',') {
            expectValue = true;
        } else if (expectValue) {
            yield { text, line, start, end: offset, kind: clause == null ? 'subject' : 'value', statement, clause };
            expectValue = false;
        } else {
            clause = text;
            expectValue = index < tokens.length;
        }
    }
}

/** Every word of the file that can refer to something, in file order. */
export function tokensOf(source: string, parsed: ParseResult = parse(source)): DiagramToken[] {
    const lines = linesOf(source);
    const tokens: DiagramToken[] = [];

    for (const statement of parsed.statements) {
        tokens.push(...statementTokens(statement, lines[statement.line - 1]!, statement.line - 1));
    }

    for (const definition of parsed.definitions) {
        const line = definition.line - 1;
        const start = lines[line]!.lastIndexOf(definition.id);

        tokens.push({ text: definition.id, line, start, end: start + definition.id.length, kind: 'definition' });

        for (const field of fieldsOf(definition, lines)) {
            if (ELEMENT_FIELDS.has(field.key) && field.value !== '' || field.key === 'attached' && definition.kind === 'action' && !/^(?:true|false)$/.test(field.value)) {
                tokens.push({ text: field.value, line: field.line, start: field.valueStart, end: field.valueStart + field.value.length, kind: 'field', field: field.key });
            } else if ((field.key === 'on:enter' || field.key === 'on:exit') && field.value !== '') {
                // A hook line has no timestamp of its own, and only its columns matter here.
                for (const hook of parse(`0 ${field.value}`).statements) {
                    tokens.push(...statementTokens(hook, lines[field.line]!, field.line, SUBJECTLESS_HOOK.test(field.value)));
                }
            }
        }
    }

    return tokens;
}

/** Whether every `[` of `text` has its `]`. The compiler can't expand a template that's missing one. */
export function hasBalancedBrackets(text: string): boolean {
    return text.split('[').length === text.split(']').length;
}

/** The IDs a token stands for. A half-typed template stands for itself. */
export function idsOf(token: string): string[] {
    return hasBalancedBrackets(token) ? expandTemplate(token) : [token];
}

/** The definition's or action's key of an ID (`boss` for `boss#eye`). */
export function baseOf(id: string): string {
    const hash = id.indexOf('#');

    return hash === -1 ? id : id.slice(0, hash);
}

/** The IDs that statements bring into the fight. */
export function liveIdsOf(tokens: DiagramToken[]): Set<string> {
    const ids = new Set<string>();

    for (const token of tokens) {
        const { statement } = token;

        if (token.kind === 'subject' && statement?.sign === '+' && ['actor', 'object', 'puddle', 'headmarker', 'tether', 'aoe'].includes(statement.verb)) {
            idsOf(token.text).filter(id => !id.includes('*')).forEach(id => ids.add(id));
        }
    }

    return ids;
}

/** The keys of the status effects that the `.diagram` file `textDocument` names. */
export function statusKeysOf(textDocument: TextDocument): Set<string> {
    return new Set(tokensOf(textDocument.getText())
        .filter(token => token.statement?.verb === 'status' && token.kind === 'subject')
        .map(token => token.text.replace(/:\d+$/, '')));
}

/**
 * Whether a token names the status effect, action or timeline actor `key`, as opposed to something else with the same
 * name. A `define` block's ID only counts for its own kind.
 */
function namesAs(token: DiagramToken, kind: 'action' | 'status' | 'actor', key: string, definitions: Definition[]): boolean {
    const verb = token.statement?.verb;
    const named = token.text === key || token.text.startsWith(`${key}#`);

    if (kind === 'status') {
        return verb === 'status' && token.kind === 'subject' && (token.text === key || token.text.startsWith(`${key}:`));
    }

    if (token.kind === 'definition') {
        return token.text === key && definitions.some(definition => definition.kind === kind && definition.id === key && definition.line - 1 === token.line);
    }

    if (kind === 'actor') {
        // An `+aoe`'s subject is an action, and a `flash` an element of the diagram.
        return named && verb != null && verb !== 'status' && verb !== 'effect' && verb !== 'strategy' && !(verb === 'aoe' && token.kind === 'subject');
    }

    // An `attached` value is an actor's key, and a `+strategy` a strategy's ID.
    return named && verb !== 'status' && verb !== 'effect' && verb !== 'strategy' && token.field !== 'attached';
}

/** The clauses whose values name an element (`"takes": "element"` in `diagram.schema.json`). */
const ELEMENT_CLAUSES = new Set(['at', 'on', 'to', 'toward', 'hits']);

/**
 * Whether a token can name an element that a `define` block defines: a subject of a statement about elements, a value
 * of an element clause, or an element field (`flash`). Statuses, effect presets, AoEs' actions and strategies can't.
 */
export function namesElement(token: DiagramToken, definitions: Definition[]): boolean {
    const verb = token.statement?.verb;

    if (token.kind === 'definition' || isStrategyToken(token, definitions)) return false;
    if (token.kind === 'field') return true;
    if (token.kind === 'value') return ELEMENT_CLAUSES.has(token.clause ?? '');

    return verb !== 'status' && verb !== 'effect' && verb !== 'aoe';
}

/** Where `id` stands in a token's text as a whole ID or an ID's base: in `id`, `id#2` and the ends of `x@id>T1`, not in `boss#id`. */
function idPattern(id: string): RegExp {
    return new RegExp(`(?<![\\w#-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
}

/** Where `id` stands in `token`'s text, by its column in the line. */
export function idColumnsIn(token: DiagramToken, id: string): number[] {
    return [...token.text.matchAll(idPattern(id))].map(match => token.start + match.index!);
}

/**
 * Where the `.diagram` file `textDocument` names what its `define <kind> <id>` block defines, to rename it: the
 * block's ID; for an element, each ID or ID base that {@link namesElement} tokens give; for a gradient, each
 * `url(#<id>)`; for a strategy, each `+strategy`. An arena's are only its block's: the timeline's `<arena>` items name
 * it. Actions and timeline actors are the timeline's keys, which {@link occurrencesOf} finds.
 */
export function definitionOccurrencesOf(textDocument: TextDocument, kind: Definition['kind'], id: string): Range[] {
    const source = textDocument.getText();
    const parsed = parse(source);
    const tokens = tokensOf(source, parsed);
    const definition = parsed.definitions.find(x => x.kind === kind && x.id === id);
    const at = (line: number, character: number): Range => ({ start: { line, character }, end: { line, character: character + id.length } });
    const ranges: Range[] = [];
    const own = definition == null ? undefined : tokens.find(token => token.kind === 'definition' && token.line === definition.line - 1);

    if (own != null) ranges.push(at(own.line, own.start));

    if (kind === 'strategy') {
        for (const token of tokens.filter(token => token.kind !== 'definition' && isStrategyToken(token, parsed.definitions) && token.text === id)) {
            ranges.push(at(token.line, token.start));
        }
    } else if (kind === 'gradient') {
        linesOf(source).forEach((text, line) => {
            for (const match of text.matchAll(new RegExp(`url\\(#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'))) ranges.push(at(line, match.index! + 'url(#'.length));
        });
    } else if (kind !== 'arena' && kind !== 'coordinate-space') {
        for (const token of tokens.filter(token => namesElement(token, parsed.definitions))) {
            ranges.push(...idColumnsIn(token, id).map(column => at(token.line, column)));
        }
    }

    return ranges;
}

/** Where the `.diagram` file `textDocument` names the action, status effect or timeline actor `key`: only the key itself, without a sub-ID. */
export function occurrencesOf(textDocument: TextDocument, kind: 'action' | 'status' | 'actor', key: string): Range[] {
    const source = textDocument.getText();
    const parsed = parse(source);
    const ranges: Range[] = tokensOf(source, parsed)
        .filter(token => namesAs(token, kind, key, parsed.definitions))
        .map(token => ({ start: { line: token.line, character: token.start }, end: { line: token.line, character: token.start + key.length } }));

    // `attached: <actor key>` on a `define action`.
    if (kind === 'actor') {
        const lines = linesOf(source);

        for (const definition of parsed.definitions.filter(x => x.kind === 'action')) {
            const field = fieldsOf(definition, lines).find(x => x.key === 'attached' && x.value === key);

            if (field != null) ranges.push({ start: { line: field.line, character: field.valueStart }, end: { line: field.line, character: field.valueStart + key.length } });
        }
    }

    return ranges;
}
