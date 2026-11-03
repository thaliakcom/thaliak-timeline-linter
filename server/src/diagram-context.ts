// What the `.diagram` providers share: finding a `.diagram` file's timeline and the other way around,
// the facts about its actions as thaliak's build gets them, and where each word of the file is.
import * as fs from 'fs';
import * as paths from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from 'image-size';
import { Range, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { getGameAction } from './ironworks';
import { hitboxRadius, paddedEffectRange } from './tooltip';
import { ActionFacts, arenasOf, DiagramInput, expandTemplate, RawItem, usesOf } from './utility/diagram-ddl/compile';
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
 * actions get a size of 1, so that all they lose is the telegraph's timing rather than getting a false size error.
 */
export async function diagramInputOf(timeline: Timeline, diagramUri: string): Promise<{ input: DiagramInput, problems: string[] }> {
    const { js } = timeline;
    const rawActions = (js.actions ?? {}) as Record<string, ActionFacts & { id?: number, source?: number }>;
    const rawItems = (js.timeline ?? []) as RawItem[];
    const actions: Record<string, ActionFacts> = {};
    const problems: string[] = [];

    await Promise.all(Object.entries(rawActions).map(async ([key, raw]) => {
        const facts: ActionFacts = { ...raw };
        const game = raw.id != null ? await getGameAction(raw.id) : null;

        if (game != null) {
            facts.effectRange = paddedEffectRange(game, await hitboxRadius(raw.source));
            facts.xAxisModifier = game.XAxisModifier;
            facts.hasOmen = game.omenPath != null;
            facts.cast ??= game.cast100ms * 100;
            facts.name ??= game.name;
        } else if (raw.id != null) {
            facts.effectRange = 1;
            facts.xAxisModifier = 1;
        }

        actions[key] = facts;
    }));

    const arenas = arenasOf(rawItems);

    for (const arena of arenas) {
        const size = arenaImageSize(diagramUri, arena.image);

        if (size != null) {
            arena.imageSize = size;
        } else {
            problems.push(`Couldn't read the size of the arena image ${arena.image}, so sizes and speeds assume the default of 5 units per yalm.`);
        }
    }

    const arena = js.arena as number | [number, number] | undefined;

    return {
        input: {
            uses: usesOf(rawItems, rawActions),
            actions,
            arenas,
            arenaSize: typeof arena === 'number' ? [arena, arena] : arena,
            waymarks: js.waymarks
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

    for (let line = definition.line; line < lines.length; line++) {
        const raw = lines[line]!;

        if (raw.trim() === '') continue;
        if (!/^\s/.test(raw)) break;

        const start = raw.length - raw.trimStart().length;
        const match = definition.kind !== 'gradient' ? /^([a-zA-Z][\w-]*):(\s*)(.*)$/.exec(raw.trimStart()) : null;

        if (match != null) {
            key = match[1]!;
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
    /** What it is: a statement's subject, a value of a clause, the ID of a `define` block, or the value of `use`, `telegraph` or `flash`. */
    kind: 'subject' | 'value' | 'definition' | 'field';
    /** The statement it's part of, unless it's in a `define` block's own lines. */
    statement?: Statement;
    /** The clause it's a value of. */
    clause?: string;
}

/** Where the arguments of a statement's line start: past the timestamp and verb. */
const LINE_PREFIX = /^\s*(?:\d+\s+)?(?:[+-]?[a-z][a-z-]*:\s*)?/;
/** The fields whose value names an element. */
const ELEMENT_FIELDS = new Set(['use', 'telegraph', 'flash']);

/** Finds a statement's words in `raw`, its line. */
function* statementTokens(statement: Statement, raw: string, line: number): Generator<DiagramToken> {
    if (statement.subjects.length === 0) {
        return;
    }

    let offset = raw.indexOf(statement.text, LINE_PREFIX.exec(raw)![0].length);
    const tokens = tokenize(statement.text);
    let index = 0;
    let clause: string | undefined;
    let expectValue = true;

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
            if (ELEMENT_FIELDS.has(field.key) && field.value !== '') {
                tokens.push({ text: field.value, line: field.line, start: field.valueStart, end: field.valueStart + field.value.length, kind: 'field' });
            } else if (field.key === 'exit' && /^[+-]/.test(field.value)) {
                // A hook line has no timestamp of its own, and only its columns matter here.
                for (const hook of parse(`0 ${field.value}`).statements) {
                    tokens.push(...statementTokens(hook, lines[field.line]!, field.line));
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

        if (token.kind === 'subject' && statement?.sign === '+' && ['actor', 'marker', 'tether', 'aoe'].includes(statement.verb)) {
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

/** Whether a token names the status effect or action `key`, as opposed to an element with the same name. */
function namesAs(token: DiagramToken, kind: 'action' | 'status', key: string): boolean {
    const isStatus = token.statement?.verb === 'status';

    if (kind === 'status') {
        return isStatus && token.kind === 'subject' && (token.text === key || token.text.startsWith(`${key}:`));
    }

    return !isStatus && token.statement?.verb !== 'effect' && (token.text === key || token.text.startsWith(`${key}#`));
}

/** Where the `.diagram` file `textDocument` names the action or status effect `key`: only the key itself, without a sub-ID. */
export function occurrencesOf(textDocument: TextDocument, kind: 'action' | 'status', key: string): Range[] {
    return tokensOf(textDocument.getText())
        .filter(token => namesAs(token, kind, key))
        .map(token => ({ start: { line: token.line, character: token.start }, end: { line: token.line, character: token.start + key.length } }));
}
