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
    /**
     * Whether it has a syntax error ({@link ParseResult.syntax}), which the compiler skips it for. It's kept, with what
     * could be read of it, for what works on the file's text, such as renaming.
     */
    broken?: true;
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
    /** The 1-based line of each entry of {@link fields}, by key and in the same order. */
    fieldLines: Record<string, number[]>;
    /** The block's lines that aren't `key: value` lines, such as a gradient's `Def` string. */
    body: string[];
}

export interface ParseResult {
    statements: Statement[];
    definitions: Definition[];
    /** The `if` sections, in the order their `if` lines come in. */
    sections: Section[];
    /** Problems that don't make the file malformed, such as a timestamp out of sequence. */
    diagnostics: Diagnostic[];
    /**
     * Syntax errors: text that the grammar doesn't allow. The statement or field they're on is left out, and parsing
     * goes on with the next line. Unlike {@link diagnostics}, they're errors even in a fight whose diagrams are WIP.
     */
    syntax: Diagnostic[];
}

/** A `define` field of the grammar (`define.<kind>.fields` in `diagram.schema.json`). */
export interface GrammarField {
    /** The types its value can have, as {@link valueTypeOf} names them. */
    type?: string | string[];
    /** The values it can have, with what each means. */
    values?: Record<string, string>;
    /** Where its values are listed instead: paths in the grammar, such as `looks.aoes`. */
    valuesFrom?: string[];
}

/** A verb of the grammar, by the word as it's written, with its sign (`verbs` in `diagram.schema.json`). */
export interface GrammarVerb {
    /** What follows the verb: `text`, `subjects`, or nothing at all. */
    arguments?: string;
    /** Its own clauses, whose values have the clause's `form`. */
    clauses?: string[];
    /** The element fields it takes as clauses, whose values have the field's `type`. */
    props?: string[];
    /** The clauses it needs. */
    required?: string[];
    /** Groups of clauses of which it needs exactly one. */
    oneOf?: string[][];
    /** The forms of clauses whose values differ here from the clause's own `form`. */
    forms?: Record<string, string>;
    /** Whether its other clauses are the parameters of a preset, which the compiler checks. */
    parameters?: boolean;
}

/**
 * The grammar of `.diagram` files: `_site/_data/schemas/diagram.schema.json`, of which the parser and the compiler read
 * these parts. Whoever parses passes it in, so that this module has no dependencies.
 */
export interface DdlGrammar {
    verbs: Record<string, GrammarVerb>;
    /** By key. `form` is the shape of its value; see {@link matchesForm}. */
    clauses: Record<string, { form?: string }>;
    /** By kind, each with its `fields`; `element` has the fields of every element kind. */
    define: Record<string, unknown>;
    looks: Record<string, Record<string, string>>;
    animations: Record<string, unknown>;
}

/** The fields of a kind's `define` block in `grammar`, without the shared element fields. */
function ownFields(grammar: DdlGrammar, kind: string): Record<string, GrammarField> {
    return (grammar.define[kind] as { fields?: Record<string, GrammarField> } | undefined)?.fields ?? {};
}

/** The element fields that `define action` can't have, since its timeline action decides them. */
const ACTION_TIMELINE_KEYS = new Set(['type', 'size', 'angle', 'look']);

/** The fields a `define` block of `kind` can have: an action's own and the element fields it may style, or an element kind's. */
export function fieldsOfKind(grammar: DdlGrammar, kind: string): Record<string, GrammarField> {
    switch (kind) {
        case 'gradient':
        case 'coordinate-space': return {};
        case 'strategy': return ownFields(grammar, 'strategy');
        case 'action': return Object.fromEntries(Object.entries({ ...ownFields(grammar, 'action'), ...ownFields(grammar, 'element') }).filter(([key]) => !ACTION_TIMELINE_KEYS.has(key)));
        default: return { ...ownFields(grammar, 'element'), ...ownFields(grammar, kind) };
    }
}

/** The values and their meanings that `field` lists itself or through `valuesFrom`. */
export function valuesOf(grammar: DdlGrammar, field: GrammarField): Record<string, string> {
    const lists = (field.valuesFrom ?? []).map(path => path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], grammar) as Record<string, string> | undefined);

    return Object.assign({}, field.values, ...lists);
}

/** The rules of `sign` and `verb` in `grammar`. A verb with the wrong sign, which has its own diagnostic, gets those of its right one. */
function rulesOf(grammar: DdlGrammar, sign: string, verb: string): GrammarVerb | undefined {
    return grammar.verbs[`${sign}${verb}`] ?? grammar.verbs[verb] ?? grammar.verbs[`+${verb}`];
}

/**
 * The internal subject of an action hook's statement that starts with a clause instead of a subject
 * (`on:enter: teleport: to (0, 0) toward 180`): the action's caster. It isn't part of the DDL.
 */
export const CASTER = '$caster';

/** An action hook's statement with {@link CASTER} as its subject if it starts with a clause instead of one. */
export function withCaster(hook: string): string {
    return hook.replace(/^([+-]?[a-z][a-z-]*:)\s+(?=(?:to|toward|rotate|over)\b)/, `$1 ${CASTER} `);
}

/**
 * Reads the value of the `define` field `key`: `true` or `false`, a number, a fixed-size list of numbers written like a
 * coordinate (`origin: (0.5, 0)`), or else the text as it is. {@link CLAUSE_FIELDS} take their kind and clauses
 * instead. Throws on objects and lists (`{ … }`, `[ … ]`), which aren't part of the DDL.
 */
export function readFieldValue(key: string, text: string): unknown {
    const clauseField = CLAUSE_FIELDS[key];

    if (/^[{[]/.test(text)) throw new Error(`objects and lists aren't part of the DDL${clauseField != null ? `: write it as "${clauseField.example}"` : ''}`);
    if (clauseField != null) return readClauseField(key, text, clauseField);
    if (text === 'true' || text === 'false') return text === 'true';
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    if (ROUND_TUPLE.test(text)) return text.slice(1, -1).split(',').map(Number);

    return text;
}

/** A whole value that's a fixed-size list of numbers in round brackets, written like a coordinate: `(0.5, 0)`. */
const ROUND_TUPLE = /^\(\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)+\s*\)$/;
/**
 * The `define` fields whose value is a kind, which is never optional, followed by `key value` clauses:
 * `look: plain color #FFF6D5`. `kind` names what comes first, `example` shows the form, and `clauses` lists the
 * clauses it takes, if not any parameter of its look or animation.
 */
const CLAUSE_FIELDS: Record<string, { kind: string, example: string, clauses?: readonly string[] }> = {
    look: { kind: 'type', example: 'look: plain color #FFF6D5' },
    enter: { kind: 'type', example: 'enter: scale speed 2' },
    exit: { kind: 'type', example: 'exit: tornado speed 0.5 height 1.5' },
    stroke: { kind: 'style', example: 'stroke: dashed color #FFB4B4', clauses: ['color'] },
    extrude: { kind: 'height', example: 'extrude: 1.5 color #000000BB', clauses: ['color'] }
};
/** The styles a `stroke` can have. */
const STROKE_STYLES = ['solid', 'dashed'];

/**
 * Reads the value of one of the {@link CLAUSE_FIELDS}: its kind, then its clauses, as in `exit: tornado speed 0.5`.
 * A `look`, `enter` or `exit` is its type alone, or `{ type, ...parameters }`; a `stroke` is `{ style, color }`; an
 * `extrude` is `"<height> <color>"`, as the viewer takes it, and needs its color.
 */
function readClauseField(key: string, text: string, { kind, example, clauses: allowed }: { kind: string, example: string, clauses?: readonly string[] }): unknown {
    const [first, ...rest] = tokenize(text);

    if (first == null || first.startsWith('#')) throw new Error(`it starts with its ${kind}, which is never optional, as in "${example}"`);

    const clauses: Record<string, number | string> = {};

    for (let i = 0; i < rest.length; i += 2) {
        const clause = rest[i]!;
        const value = rest[i + 1];

        if (allowed != null && !allowed.includes(clause)) throw new Error(`only ${allowed.map(name => `"${name}"`).join(', ')} can follow its ${kind}, not "${clause}", as in "${example}"`);
        if (value == null || value === ',') throw new Error(`"${clause}" has no value, as in "${example}"`);
        if (clause in clauses) throw new Error(`"${clause}" is given twice`);

        clauses[clause] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    }

    switch (key) {
        case 'stroke':
            if (!STROKE_STYLES.includes(first)) throw new Error(`its style is ${STROKE_STYLES.join(' or ')}, not "${first}", as in "${example}"`);
            return { style: first, ...clauses };
        case 'extrude':
            if (!/^\d+(\.\d+)?$/.test(first)) throw new Error(`its height is a number, not "${first}", as in "${example}"`);
            if (clauses.color == null) throw new Error(`it needs a color, as in "${example}"`);
            return `${first} ${clauses.color}`;
        default:
            return rest.length === 0 ? first : { type: first, ...clauses };
    }
}

/**
 * The name of a value's type, as the grammar names it, from {@link readFieldValue}: a list of numbers is a `point`,
 * which is written like a coordinate, and a value with clauses (`look: plain color #FFF6D5`) is a `string`.
 */
export function valueTypeOf(value: unknown): string {
    if (Array.isArray(value)) return 'point';

    return value === null ? 'null' : typeof value === 'object' ? 'string' : typeof value;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
/** `(a, b)`, `cart(x, y)` or `polar(d, a)`. */
const PAIR = new RegExp(String.raw`^(?:cart|polar)?\(\s*${NUMBER}\s*,\s*${NUMBER}\s*\)$`);
/** An element's ID, which may have a sub-ID (`#`), a tether's ends (`@A>B`), `*` and `<id>` or `<group>` in it. */
const ELEMENT = /^[A-Za-z_<$*][^\s",]*$/;

/** What each clause value form is, for the messages about values that don't have it. */
const FORM_NAMES: Record<string, string> = {
    position: 'a spot, such as (10, 90), cart(10, -5), polar(10, 90) or clocks(63), or an element',
    element: 'an element',
    'angle-or-element': 'an angle in degrees, such as 90 or -45, or an element',
    duration: 'a duration, such as 1000ms or 1.5s',
    'signed-number': 'a signed number of degrees, such as +90 or -45 (to face an angle, use "toward")',
    pair: 'a pair, such as (10, 90), cart(10, -5) or polar(10, 90)',
    'positive-number': 'a number above 0',
    label: 'a label',
    integer: 'a game action ID'
};

/** Whether `value`, without templates (see {@link alternatives}), has the clause value form `form`. An unknown form allows anything. */
function matchesForm(form: string, value: string): boolean {
    switch (form) {
        // A placeholder needs its arguments, and an ID may have brackets, as `run-dynamis-(delta-version)` does, but not empty ones.
        case 'position': return PAIR.test(value) || /^[a-z][\w-]*\(.+\)$/.test(value) || ELEMENT.test(value) && !/\(\s*\)$/.test(value);
        case 'element': return ELEMENT.test(value);
        case 'angle-or-element': return new RegExp(`^${NUMBER}$`).test(value) || ELEMENT.test(value);
        case 'duration': return /^\d+(\.\d+)?(ms|s)?$/.test(value);
        case 'signed-number': return /^[+-]\d+(\.\d+)?$/.test(value);
        case 'pair': return PAIR.test(value);
        case 'positive-number': return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
        case 'integer': return /^\d+$/.test(value);
        default: return true;
    }
}

/** Splits `text` on commas outside of brackets. */
function splitTop(text: string): string[] {
    const parts: string[] = [];
    let depth = 0, current = '';

    for (const c of text) {
        if ('(['.includes(c)) depth++;
        if (')]'.includes(c)) depth--;

        if (c === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }

    return [...parts, current.trim()];
}

/**
 * The values a templated value can stand for, to check their form: `[a, b]` for each option, `[1..3]` for its first,
 * and `[*]` as `*`. As the compiler's `expandTemplate`, but without player groups, which are elements either way.
 */
function alternatives(value: string): string[] {
    const open = value.indexOf('[');
    const close = findClose(value, open);

    if (open < 0 || close < 0) return [value];

    const inner = value.slice(open + 1, close).trim();
    const range = /^(\d+)\.\.\d+$/.exec(inner);
    const options = inner === '*' ? ['*'] : range != null ? [range[1]!] : splitTop(inner);

    return options.flatMap(option => alternatives(value.slice(0, open) + option + value.slice(close + 1)));
}

/** The index of the `]` that closes the `[` at `open`, or -1. */
function findClose(text: string, open: number): number {
    if (open < 0) return -1;

    let depth = 0;

    for (let i = open; i < text.length; i++) {
        if (text[i] === '[') depth++;
        if (text[i] === ']' && --depth === 0) return i;
    }

    return -1;
}

/** Whether every `(`, `[`, `<` and `"` of `text` is closed, as {@link tokenize} reads them. */
function isBalanced(text: string): boolean {
    let depth = 0, angles = 0, quoted = false;

    for (const c of text) {
        if (c === '"') quoted = !quoted;
        if (quoted) continue;
        if ('(['.includes(c)) depth++;
        if (')]'.includes(c)) depth--;
        if (depth < 0) return false;

        if (c === '<') {
            angles++;
        } else if (c === '>' && angles > 0) {
            angles--;
        }
    }

    return depth === 0 && angles === 0 && !quoted;
}

/**
 * What's wrong with the clauses of a statement of `sign` and `verb` by `grammar`, if anything: a clause it doesn't
 * take, one given twice, a value without its form, or a clause it needs that's missing.
 */
function clauseProblem(grammar: DdlGrammar, sign: string, verb: string, clauses: Clause[]): string | undefined {
    const rules = rulesOf(grammar, sign, verb) ?? {};
    const written = `${sign}${verb}`;
    const own = rules.clauses ?? [];
    const props = rules.props ?? [];
    const seen = new Set<string>();

    for (const { key, values } of clauses) {
        if (seen.has(key)) return `"${key}" is given twice`;

        seen.add(key);

        if (own.includes(key)) {
            const form = rules.forms?.[key] ?? grammar.clauses[key]?.form;
            const wrong = form == null ? undefined : values.flatMap(alternatives).find(value => !matchesForm(form, value));

            if (wrong != null) return `"${key}" takes ${FORM_NAMES[form!] ?? form}, not "${wrong}"`;
        } else if (props.includes(key)) {
            const field = ownFields(grammar, 'element')[key];
            const types = field?.type == null ? [] : [field.type].flat();
            const wrong = values.find(value => types.length > 0 && !types.includes(valueTypeOf(readFieldValue(key, value))));

            if (wrong != null) return `"${key}" takes ${types.join(' or ')}, not "${wrong}"`;
        } else if (!rules.parameters) {
            const takes = [...own, ...props];

            return `"${written}" has no clause "${key}"${takes.length > 0 ? `; it takes ${takes.map(name => `"${name}"`).join(', ')}` : ''}`;
        }
    }

    const missing = (rules.required ?? []).find(key => !seen.has(key));

    if (missing != null) return `"${written}" needs "${missing}"`;

    const group = (rules.oneOf ?? []).find(keys => keys.filter(key => seen.has(key)).length !== 1);

    if (group != null) return `"${written}" needs exactly one of ${group.map(key => `"${key}"`).join(' or ')}`;

    return undefined;
}

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
export function stripComment(line: string): string {
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
export function parse(source: string, grammar: DdlGrammar): ParseResult {
    const statements: Statement[] = [];
    const definitions: Definition[] = [];
    const diagnostics: Diagnostic[] = [];
    const syntax: Diagnostic[] = [];
    const syntaxError = (line: number, message: string) => {
        syntax.push({ line, message });
    };
    let at = 0;
    /** The verb that lines without one continue. `unknown` if it isn't a verb, whose lines are then left out silently. */
    let verb: { sign: Statement['sign'], name: string, unknown?: true } | null = null;
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
                syntaxError(line, `an "if ${sectionKind}" can't be inside another "if ${sectionKind}"`);
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
            syntaxError(line, `"${word}" without an "if"`);
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

        if (top.hasElse) syntaxError(line, `"${word}" after "else"`);

        if (word === 'else') {
            if (top.section.kind === 'branch') {
                syntaxError(line, '"else" is only for "if strategy": each branch option needs a name, as in "elif branch <name>:"');
                return;
            }

            top.hasElse = true;
        } else if (kind !== top.section.kind) {
            syntaxError(line, `"elif ${kind}" in an "if ${top.section.kind}" section`);
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
                syntaxError(line, 'name a strategy, as in "if strategy lpdu:"');
                return null;
            }

            return { kind, names, else: false, line };
        }

        if (rest === '') {
            syntaxError(line, 'name the branch option, as in "if branch Left:"');
            return null;
        }

        return { kind, group, name: rest, first: first?.kind === 'branch' ? first.first : rest, line };
    };

    const add = (line: number, text: string) => {
        if (verb == null) {
            syntaxError(line, `"${text}" has no verb to continue`);
            return;
        }

        // The verb's own line has the error already.
        if (verb.unknown) return;

        if (needsTime != null) {
            diagnostics.push({ line, message: `a timestamp is needed after an "endif" whose arms go on until ${needsTime}` });
            needsTime = null;
        }

        if (verb.name === 'skip' && open.length > 0) diagnostics.push({ line, message: '"skip" can\'t be inside an "if" section' });

        const statement: Statement = { line, at, sign: verb.sign, verb: verb.name, text, subjects: [], clauses: [], arms };
        const rules = rulesOf(grammar, verb.sign, verb.name);

        /** The statement's first syntax error, if it has one. Its subjects and clauses are read as far as they can be. */
        const problem = ((): string | undefined => {
            if (text !== '' && rules?.arguments == null) return `"${verb!.sign}${verb!.name}" takes no arguments`;
            if (rules?.arguments === 'text' || text === '') return undefined;

            const quoted = quotedValue(text, verb!.name);
            const tokens = tokenize(text);
            const [subjects, first] = readList(tokens, 0);
            let i = first;
            statement.subjects = subjects;

            while (i < tokens.length) {
                const key = tokens[i]!;

                if (i + 1 >= tokens.length) return `"${key}" has no value`;

                const [values, next] = readList(tokens, i + 1);
                statement.clauses.push({ key, values });
                i = next;
            }

            if (quoted != null) return quoteMessage(quoted);
            if (!isBalanced(text)) return 'a "(", "[", "<" or quote here isn\'t closed, or a ")" or "]" isn\'t opened';

            return clauseProblem(grammar, verb!.sign, verb!.name, statement.clauses);
        })();

        // The compiler skips it, so that what's malformed has no effect.
        if (problem != null) {
            syntaxError(line, problem);
            statement.broken = true;
        }

        statements.push(statement);
    };

    /** Leaves out the field `key` of `definition`, after a syntax error in it. */
    const dropField = (definition: Definition, key: string) => {
        delete definition.fields[key];
        delete definition.fieldLines[key];
    };

    /**
     * Checks a `define` block against the grammar, once it's read: its kind's fields and their values, and the
     * statements of its hooks, each on its own line. A field with a syntax error is left out.
     */
    const checkDefinition = (definition: Definition) => {
        if (definition.kind === 'gradient') return;

        if (definition.kind === 'coordinate-space') {
            if (definition.id !== 'cartesian' && definition.id !== 'polar') syntaxError(definition.line, `"define coordinate-space ${definition.id}": the coordinate space is cartesian or polar`);
            if (Object.keys(definition.fields).length > 0 || definition.body.length > 0) syntaxError(definition.line, '"define coordinate-space" takes no fields');

            return;
        }

        const known = fieldsOfKind(grammar, definition.kind);

        for (const [key, values] of Object.entries(definition.fields)) {
            const lines = definition.fieldLines[key]!;

            if (known[key] == null) {
                syntaxError(lines[0]!, key.startsWith('on:') ? `"${key}" isn't a hook: on:enter or on:exit`
                    : definition.kind === 'action' && ACTION_TIMELINE_KEYS.has(key) ? `"${definition.id}" can't have a "${key}": ${key === 'look' ? 'AoE looks come from omens.yaml' : 'its timeline action decides it'}`
                    : `"${key}" isn't a field of ${definition.kind} definitions`);
                dropField(definition, key);
                continue;
            }

            if (key === 'on:enter' || key === 'on:exit') {
                // Each line is a statement of its own, as the compiler runs them. An action's may start with a clause, for its caster.
                values.forEach((hook, i) => {
                    if (hook === '') return;

                    const parsed = parse(`0 ${definition.kind === 'action' ? withCaster(hook) : hook}`, grammar);

                    for (const item of parsed.syntax) syntaxError(lines[i]!, item.message);
                    for (const item of parsed.diagnostics) diagnostics.push({ line: lines[i]!, message: item.message });
                });

                continue;
            }

            const text = values.join(' ');

            // The parser reported the quotes already.
            if (text.includes('"')) {
                dropField(definition, key);
                continue;
            }

            const spec = known[key]!;
            const problem = ((): string | undefined => {
                if (!isBalanced(text)) return `"${key}": a "(", "[", "<" or quote isn't closed, or a ")" or "]" isn't opened`;

                let value: unknown;

                try {
                    value = readFieldValue(key, text);
                } catch (e) {
                    return `"${key}" of "${definition.id}" can't be read: ${e instanceof Error ? e.message : e}`;
                }

                const types = spec.type == null ? [] : [spec.type].flat();
                const allowed = valuesOf(grammar, spec);
                const name = typeof value === 'object' && value != null && !Array.isArray(value) ? (value as { type?: unknown }).type : value;

                if (types.length > 0 && !types.includes(valueTypeOf(value))) return `"${key}" takes ${types.join(' or ')}, not ${valueTypeOf(value)}`;
                if (Object.keys(allowed).length > 0 && typeof name === 'string' && allowed[name] == null) return `"${name}" isn't one of the values of "${key}": ${Object.keys(allowed).join(', ')}`;

                return undefined;
            })();

            if (problem != null) {
                syntaxError(lines[0]!, problem);
                dropField(definition, key);
            }
        }
    };

    source.split(/\r?\n/).forEach((raw, index) => {
        const line = index + 1;
        let text = stripComment(raw).trim();

        if (text === '') return;

        if (text === '...' || text.endsWith(' ...')) {
            syntaxError(line, 'elided content ("...")');
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

            if (kind == null) syntaxError(line, `"define ${define[2]}" needs a kind: ${DEFINE_KINDS}`);
            else if (skipping) syntaxError(line, `"${kind}" isn't a kind: ${DEFINE_KINDS}`);

            if (skipping) return;

            definition = { line, kind: kind as Definition['kind'], id: define[2]!, fields: {}, fieldLines: {}, body: [] };
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

            if (quoted != null) syntaxError(line, quoteMessage(quoted));

            if (match != null && definition.kind !== 'gradient' && !(field != null && indent > keyIndent)) {
                keyIndent = Math.min(keyIndent, indent);
                field = match[1]!;
                (definition.fields[field] ??= []).push(match[2]!);
                (definition.fieldLines[field] ??= []).push(line);
            } else if (field != null) {
                definition.fields[field]!.push(text);
                definition.fieldLines[field]!.push(line);
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
                syntaxError(line, 'an "if", "elif", "else" or "endif" line takes no timestamp: put it on its own line');
                readSection(line, timed);
                return;
            }

            if (text === '') return;
        }

        const match = VERB_LINE.exec(text);

        // Without a colon, only a known verb on its own counts. `omega-m at (0, 0)` and `remote-code-smell` are continuations.
        if (match != null && (match[3] != null || match[4] == null && VERBS.has(match[2]!))) {
            if (!VERBS.has(match[2]!)) {
                syntaxError(line, `unknown verb "${match[2]}"`);
                verb = { sign: match[1] as Statement['sign'], name: match[2]!, unknown: true };
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
        syntaxError(section.arms[0]!.line, '"if" without "endif"');
        section.endLine = lastLine;
        section.last = last;
    }

    for (const definition of definitions) checkDefinition(definition);

    return { statements, definitions, sections, diagnostics, syntax };
}
