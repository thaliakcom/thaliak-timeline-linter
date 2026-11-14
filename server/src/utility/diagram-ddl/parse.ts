// Parser for the encounter diagram DDL (`_site/_data/<category>/<shorthand>.diagram`).
// Pure text to AST, with no dependencies, so that the timeline linter can share it.

/**
 * A problem found in a file. `line` is 1-based, or 0 if it has no single line. `scope` says which strategy and branch
 * options it comes up under (as `Scope` in seek.ts), if not under all of them.
 */
export interface Diagnostic {
    line: number;
    message: string;
    scope?: { strategy?: string, branches?: Record<number, string> };
}

/**
 * What to add to a diagnostic's message to say where it comes up, such as ` (only in strategy NAUR, branch Left)`, or
 * nothing if it comes up everywhere. `strategyName` gives a strategy's name from its ID.
 */
export function scopeNote(diagnostic: Diagnostic, strategyName: (id: string) => string): string {
    const parts = [
        ...(diagnostic.scope?.strategy != null ? [`strategy ${strategyName(diagnostic.scope.strategy)}`] : []),
        ...Object.values(diagnostic.scope?.branches ?? {}).map(name => `branch ${name}`)
    ];

    return parts.length > 0 ? ` (only in ${parts.join(', ')})` : '';
}

/** A keyword and its comma-separated values, such as `on T1, R2`. */
export interface Clause {
    key: string;
    values: string[];
}

/** One statement. Continuation lines become separate statements with the same `at` and verb. */
export interface Statement {
    line: number;
    at: number;
    sign: '+' | '-' | '';
    verb: string;
    /** Everything after the verb, for verbs that take free text. */
    text: string;
    subjects: string[];
    clauses: Clause[];
    /** The arms of the `if` sections it's inside of, outermost first. A statement outside of any holds for every strategy and branch. */
    arms: Arm[];
}

/**
 * One arm of an `if` section, whose header line is `line`.
 *
 * - `strategy`: `if strategy a, b:` and `elif strategy …:` hold for the strategies in `names`. `else:` holds for every
 *   strategy but those of the section's earlier arms, which are its `names`.
 * - `branch`: `if branch <name>:` and `elif branch <name>:` hold for one option of a branch group. `group` is the
 *   section's start time, which identifies the group, and `first` the name of its first option, which plays unless
 *   another one is chosen.
 */
export type Arm =
    | { kind: 'strategy', names: string[], else: boolean, line: number }
    | { kind: 'branch', group: number, name: string, first: string, line: number };

/** An `if` … `endif` section. */
export interface Section {
    kind: 'strategy' | 'branch';
    /** The time it starts at: that of the lines before its `if`. Every arm starts there. */
    at: number;
    /** The arms of the sections it's inside of, outermost first. */
    within: Arm[];
    /** Its arms, in order. */
    arms: Arm[];
    /** The line of its `endif`, or the file's last line if it has none. */
    endLine: number;
    /** The latest timestamp in any of its arms, nested sections' included, or {@link at} if they have none. */
    last: number;
    /** The first timestamp after its `endif` in the same arm (or outside of any), if there is one. */
    end?: number;
}

/** A choice of strategy and branch options, as `<diagram-player>` has it (`Selection` in seek.ts). */
interface Choices {
    strategy?: string;
    /** The chosen option's name, per branch group's start time. */
    branches: Record<number, string>;
}

/**
 * Returns whether something inside `arms` holds under a choice of strategy and branch options. An unset strategy is
 * the first of `strategies` (the file's `define strategy` IDs, in order), and an unset branch the group's first option.
 */
export function armsApply(arms: readonly Arm[], choices: Choices, strategies: readonly string[]): boolean {
    const strategy = choices.strategy ?? strategies[0];

    return arms.every(arm => arm.kind === 'strategy'
        ? strategy != null && arm.names.includes(strategy) !== arm.else
        : (choices.branches[arm.group] ?? arm.first) === arm.name);
}

/**
 * A `define` block. The ID-less `define arena`, which every `define arena <id>` builds on, has the `id` `arena`.
 * `define coordinate-space` has the space (`cartesian` or `polar`) as its `id`.
 */
export interface Definition {
    line: number;
    kind: 'arena' | 'actor' | 'object' | 'puddle' | 'tether' | 'action' | 'gradient' | 'strategy' | 'coordinate-space';
    id: string;
    /** The block's `key: value` lines. A key's later lines (such as a second `exit` statement) are extra entries. */
    fields: Record<string, string[]>;
    /** The block's lines that aren't `key: value` lines, such as a gradient's `Def` string. */
    body: string[];
}

export interface ParseResult {
    statements: Statement[];
    definitions: Definition[];
    /** The `if` sections, in the order their `if` lines come in. */
    sections: Section[];
    diagnostics: Diagnostic[];
}

/** Verbs whose argument is free text rather than a subject and clauses. */
const TEXT_VERBS = new Set(['hint', 'thumbnail']);
const VERBS = new Set(['keyframe', 'skip', 'thumbnail', 'hint', 'actor', 'object', 'puddle', 'headmarker', 'tether', 'status', 'place', 'effect', 'set', 'depart', 'arrive', 'teleport', 'follow', 'turn']);
/** An `if strategy a, b:`, `elif branch <name>:`, `else:` or `endif` line. */
const SECTION_LINE = /^(?:(if|elif)\s+(strategy|branch)\b\s*(.*?)\s*:|(else)\s*:|(endif))$/;
/**
 * The signs each verb takes: both `+` (appears) and `-` (is removed), only `+`, or none, for verbs that change or set
 * something rather than make it appear.
 */
const VERB_SIGNS: Record<string, readonly Statement['sign'][]> = {
    actor: ['+', '-'], object: ['+', '-'], puddle: ['+', '-'], headmarker: ['+', '-'], tether: ['+', '-'], status: ['+', '-'],
    hint: ['+', '-'], follow: ['+', '-'],
    effect: ['+'],
    keyframe: [''], skip: [''], thumbnail: [''], set: [''], depart: [''], arrive: [''], teleport: [''], turn: [''], place: ['']
};

/** What's wrong with `sign` on `verb`, if anything. Unknown verbs have their own error, so they get none here. */
export function signProblem(sign: string, verb: string): string | undefined {
    const signs = VERB_SIGNS[verb];

    if (signs == null || (signs as readonly string[]).includes(sign)) return undefined;
    if (signs.length === 1 && signs[0] === '') return `"${sign}${verb}" takes no sign: write "${verb}"`;
    if (signs.length === 1) return `"${sign}${verb}" only takes "+": write "+${verb}"`;

    return `"${verb}" needs a sign: "+${verb}" or "-${verb}"`;
}
const VERB_LINE = /^([+-]?)([a-z][a-z-]*)(:)?(?:\s+(.*))?$/;
const DEFINE_LINE = /^define\s+(?:(\S+)\s+)?(\S+)$/;
const KINDS: readonly string[] = ['arena', 'actor', 'object', 'puddle', 'tether', 'action', 'gradient', 'strategy', 'coordinate-space'] satisfies Definition['kind'][];
const DEFINE_KINDS = 'define arena, actor, object, puddle, tether, action, gradient, strategy or coordinate-space';
/** A `key: value` line of a `define` block. Hooks have an `on:` prefix (`on:exit: +effect: fire`). */
const FIELD_LINE = /^((?:on:)?[a-zA-Z][\w-]*):\s*(.*)$/;

/** Removes a `//` comment that isn't inside a string. */
function stripComment(line: string): string {
    let quoted = false;

    for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '"') quoted = !quoted;
        if (!quoted && line[i] === '/' && line[i + 1] === '/') return line.slice(0, i);
    }

    return line;
}

/**
 * Splits arguments on whitespace outside of `()`, `[]`, `<>` and strings. Commas outside of those are their own tokens.
 * A `>` without an open `<`, as in the tether `far-tether@T1>R2`, is part of its token.
 */
export function tokenize(text: string): string[] {
    const tokens: string[] = [];
    let current = '', depth = 0, angles = 0, quoted = false;
    const flush = () => {
        if (current !== '') tokens.push(current);
        current = '';
    };

    for (const c of text) {
        if (c === '"') quoted = !quoted;

        if (!quoted) {
            if ('(['.includes(c)) depth++;
            if (')]'.includes(c)) depth--;

            if (c === '<') {
                angles++;
                depth++;
            } else if (c === '>' && angles > 0) {
                angles--;
                depth--;
            }

            if (depth === 0 && /\s/.test(c)) {
                flush();
                continue;
            }

            if (depth === 0 && c === ',') {
                flush();
                tokens.push(',');
                continue;
            }
        }

        current += c;
    }

    flush();
    return tokens;
}

/**
 * The first quoted value in `text`, a statement's arguments or a `define` field's value, unless it's a label: an `as`
 * label, or the `text` of a `set` (`verb`). Values are written bare (`color #2EA632`), and only a label may need the
 * quotes for its spaces.
 */
function quotedValue(text: string, verb?: string): string | undefined {
    const tokens = tokenize(text);

    return tokens.find((token, i) => token.includes('"') && tokens[i - 1] !== 'as' && !(verb === 'set' && tokens[i - 1] === 'text'));
}

/** Why `quoted`, from {@link quotedValue}, is wrong. */
function quoteMessage(quoted: string): string {
    return `quoted values aren't part of the DDL, except "as" labels and "set … text": write ${quoted} as ${quoted.replaceAll('"', '')}`;
}

/** Reads a `value, value, ...` list starting at `start`. Returns the values and the index after them. */
function readList(tokens: string[], start: number): [string[], number] {
    const values: string[] = [];
    let i = start;

    while (i < tokens.length) {
        values.push(tokens[i]!);
        i++;

        if (tokens[i] !== ',') break;

        i++;
    }

    return [values, i];
}

/** Parses a whole DDL file. */
export function parse(source: string): ParseResult {
    const statements: Statement[] = [];
    const definitions: Definition[] = [];
    const diagnostics: Diagnostic[] = [];
    let at = 0;
    let verb: { sign: Statement['sign'], name: string } | null = null;
    let definition: Definition | null = null;
    let field: string | null = null;
    /** How far the current `define` block's keys are indented. A line indented deeper continues the last field. */
    let keyIndent = Infinity;
    /** Whether the lines are those of a `define` block that names no kind, which its own diagnostic covers. */
    let skipping = false;
    const sections: Section[] = [];
    /** The open sections, innermost last, each with the latest timestamp in any of its arms so far and whether it had an `else`. */
    const open: { section: Section, last: number, hasElse: boolean }[] = [];
    /** The arms the next statement is inside of. A new array whenever they change, so that statements can share it. */
    let arms: Arm[] = [];
    /** The earliest time the next timestamp may have. */
    let floor = -Infinity;
    /** After an `endif` whose arms went past its start, the latest of their timestamps, until a timestamp comes. */
    let needsTime: number | null = null;
    /** Sections whose `endif` came, waiting for the next timestamp at their level (`open.length` then) for their `end`. */
    let pendingEnds: { section: Section, depth: number }[] = [];
    /** The start time of each branch section, which identifies its group, with the line of its `if`. */
    const branchGroups = new Map<number, number>();

    /** Reads an `if`, `elif`, `else` or `endif` line. */
    const readSection = (line: number, match: RegExpExecArray) => {
        const [, keyword, kind, rest] = match;
        const top = open.at(-1);
        verb = null;

        if (keyword === 'if') {
            const sectionKind = kind as Section['kind'];

            if (open.some(item => item.section.kind === sectionKind)) {
                diagnostics.push({ line, message: `an "if ${sectionKind}" can't be inside another "if ${sectionKind}"` });
            }

            const arm = newArm(line, sectionKind, rest!, at, undefined);

            if (arm == null) return;

            if (sectionKind === 'branch') {
                const other = branchGroups.get(at);

                if (other != null) diagnostics.push({ line, message: `the branch section on line ${other} also starts at ${at}; branch sections need different start times` });
                else branchGroups.set(at, line);
            }

            const section: Section = { kind: sectionKind, at, within: arms, arms: [arm], endLine: line, last: at };
            sections.push(section);
            open.push({ section, last: at, hasElse: false });
            arms = [...arms, arm];
            floor = at;
            return;
        }

        const word = keyword ?? match[4] ?? match[5]!;

        if (top == null) {
            diagnostics.push({ line, message: `"${word}" without an "if"` });
            return;
        }

        if (word === 'endif') {
            open.pop();
            // The sections inside it get their `end` from the next timestamp after it.
            for (const pending of pendingEnds) pending.depth = Math.min(pending.depth, open.length);

            top.section.endLine = line;
            top.section.last = top.last;
            arms = arms.slice(0, -1);
            at = top.section.at;
            floor = top.last;
            needsTime = top.last > top.section.at ? top.last : null;
            pendingEnds.push({ section: top.section, depth: open.length });

            const parent = open.at(-1);

            if (parent != null) parent.last = Math.max(parent.last, top.last);

            return;
        }

        // A section in the arm that just ended gets no `end` from a timestamp of the next arm, where time starts over.
        pendingEnds = pendingEnds.filter(pending => pending.depth < open.length);

        if (top.hasElse) diagnostics.push({ line, message: `"${word}" after "else"` });

        if (word === 'else') {
            if (top.section.kind === 'branch') {
                diagnostics.push({ line, message: '"else" is only for "if strategy": each branch option needs a name, as in "elif branch <name>:"' });
                return;
            }

            top.hasElse = true;
        } else if (kind !== top.section.kind) {
            diagnostics.push({ line, message: `"elif ${kind}" in an "if ${top.section.kind}" section` });
            return;
        }

        const earlier = top.section.arms.flatMap(arm => arm.kind === 'strategy' && !arm.else ? arm.names : []);
        const arm = word === 'else'
            ? { kind: 'strategy' as const, names: earlier, else: true, line }
            : newArm(line, top.section.kind, rest!, top.section.at, top.section.arms[0]);

        if (arm == null) return;

        top.section.arms.push(arm);
        arms = [...arms.slice(0, -1), arm];
        at = top.section.at;
        floor = at;
    };

    /** The arm of an `if` or `elif` line, or `null` if it names nothing. `first` is the section's first arm, if this isn't it. */
    const newArm = (line: number, kind: Section['kind'], rest: string, group: number, first: Arm | undefined): Arm | null => {
        if (kind === 'strategy') {
            const names = rest.split(',').map(name => name.trim()).filter(name => name !== '');

            if (names.length === 0) {
                diagnostics.push({ line, message: 'name a strategy, as in "if strategy lpdu:"' });
                return null;
            }

            return { kind, names, else: false, line };
        }

        if (rest === '') {
            diagnostics.push({ line, message: 'name the branch option, as in "if branch Left:"' });
            return null;
        }

        return { kind, group, name: rest, first: first?.kind === 'branch' ? first.first : rest, line };
    };

    const add = (line: number, text: string) => {
        if (verb == null) {
            diagnostics.push({ line, message: `"${text}" has no verb to continue` });
            return;
        }

        if (needsTime != null) {
            diagnostics.push({ line, message: `a timestamp is needed after an "endif" whose arms go on until ${needsTime}` });
            needsTime = null;
        }

        if (verb.name === 'skip' && open.length > 0) diagnostics.push({ line, message: '"skip" can\'t be inside an "if" section' });

        const statement: Statement = { line, at, sign: verb.sign, verb: verb.name, text, subjects: [], clauses: [], arms };

        if (!TEXT_VERBS.has(verb.name) && text !== '') {
            const quoted = quotedValue(text, verb.name);

            if (quoted != null) diagnostics.push({ line, message: quoteMessage(quoted) });

            const tokens = tokenize(text);
            const [subjects, first] = readList(tokens, 0);
            let i = first;
            statement.subjects = subjects;

            while (i < tokens.length) {
                const key = tokens[i]!;

                if (i + 1 >= tokens.length) {
                    diagnostics.push({ line, message: `"${key}" has no value` });
                    break;
                }

                const [values, next] = readList(tokens, i + 1);
                statement.clauses.push({ key, values });
                i = next;
            }
        }

        statements.push(statement);
    };

    source.split(/\r?\n/).forEach((raw, index) => {
        const line = index + 1;
        let text = stripComment(raw).trim();

        if (text === '') return;

        if (text === '...' || text.endsWith(' ...')) {
            diagnostics.push({ line, message: 'elided content ("...")' });
            return;
        }

        const define = DEFINE_LINE.exec(text);

        if (define != null && !/^\s/.test(raw)) {
            // The ID-less `define arena` is what every arena builds on.
            const arena = define[1] == null && define[2] === 'arena';
            const kind = arena ? 'arena' : define[1];

            field = null;
            keyIndent = Infinity;
            verb = null;
            definition = null;
            skipping = kind == null || !KINDS.includes(kind);

            if (kind == null) diagnostics.push({ line, message: `"define ${define[2]}" needs a kind: ${DEFINE_KINDS}` });
            else if (skipping) diagnostics.push({ line, message: `"${kind}" isn't a kind: ${DEFINE_KINDS}` });

            if (skipping) return;

            definition = { line, kind: kind as Definition['kind'], id: define[2]!, fields: {}, body: [] };
            definitions.push(definition);
            return;
        }

        // The block of a `define` without a kind is left out, since it's unclear what it defines.
        if (skipping && /^\s/.test(raw)) return;

        skipping = false;
        const section = SECTION_LINE.exec(text);

        if (section != null) {
            definition = null;
            readSection(line, section);
            return;
        }

        if (definition != null && /^\s/.test(raw)) {
            const match = FIELD_LINE.exec(text);
            const indent = /^\s*/.exec(raw)![0].length;

            // A line indented deeper than the keys, such as a second statement under `on:enter`, belongs to the last field,
            // and so does a signed one (`-actor: optical-unit`). Only an unsigned word at the keys' indent starts a new one.
            const value = match != null && definition.kind !== 'gradient' && !(field != null && indent > keyIndent) ? match[2]! : field != null ? text : undefined;
            const quoted = value != null ? quotedValue(value) : undefined;

            if (quoted != null) diagnostics.push({ line, message: quoteMessage(quoted) });

            if (match != null && definition.kind !== 'gradient' && !(field != null && indent > keyIndent)) {
                keyIndent = Math.min(keyIndent, indent);
                field = match[1]!;
                (definition.fields[field] ??= []).push(match[2]!);
            } else if (field != null) {
                definition.fields[field]!.push(text);
            } else {
                definition.body.push(text);
            }

            return;
        }

        definition = null;
        const time = /^(\d+)(?:\s+(.*))?$/.exec(text);

        if (time != null) {
            if (/^\s/.test(raw)) diagnostics.push({ line, message: 'a timestamp must start in the first column' });

            at = Number(time[1]);
            text = time[2] ?? '';
            verb = null;
            needsTime = null;

            // Time goes back only where an arm starts over. Within one, and after an `endif`, it goes on.
            if (at < floor) diagnostics.push({ line, message: `${at} is out of sequence` });

            floor = at;

            if (open.length > 0) open.at(-1)!.last = Math.max(open.at(-1)!.last, at);

            for (const pending of pendingEnds.filter(item => item.depth === open.length)) pending.section.end = at;

            pendingEnds = pendingEnds.filter(item => item.depth !== open.length);

            const timed = SECTION_LINE.exec(text);

            if (timed != null) {
                diagnostics.push({ line, message: 'an "if", "elif", "else" or "endif" line takes no timestamp: put it on its own line' });
                readSection(line, timed);
                return;
            }

            if (text === '') return;
        }

        const match = VERB_LINE.exec(text);

        // Without a colon, only a known verb on its own counts. `omega-m at (0, 0)` and `remote-code-smell` are continuations.
        if (match != null && (match[3] != null || match[4] == null && VERBS.has(match[2]!))) {
            if (!VERBS.has(match[2]!)) {
                diagnostics.push({ line, message: `unknown verb "${match[2]}"` });
                verb = null;
                return;
            }

            verb = { sign: match[1] as Statement['sign'], name: match[2]! };
            const problem = signProblem(verb.sign, verb.name);

            // Still added, so that the statement's other errors show too.
            if (problem != null) diagnostics.push({ line, message: problem });

            add(line, match[4] ?? '');
            return;
        }

        add(line, text);
    });

    const lastLine = source.split(/\r?\n/).length;

    for (const { section, last } of open) {
        diagnostics.push({ line: section.arms[0]!.line, message: '"if" without "endif"' });
        section.endLine = lastLine;
        section.last = last;
    }

    return { statements, definitions, sections, diagnostics };
}
