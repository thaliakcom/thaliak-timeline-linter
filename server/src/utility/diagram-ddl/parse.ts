// Parser for the encounter diagram DDL (`_site/_data/<category>/<shorthand>.diagram`).
// Pure text to AST, with no dependencies, so that the timeline linter can share it.

/** A problem found in a file. `line` is 1-based, or 0 if it has no single line. */
export interface Diagnostic {
    line: number;
    message: string;
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
}

/** A `define` block. */
export interface Definition {
    line: number;
    kind: 'element' | 'action' | 'gradient' | 'strategy';
    id: string;
    /** The block's `key: value` lines. A key's later lines (such as a second `exit` statement) are extra entries. */
    fields: Record<string, string[]>;
    /** The block's lines that aren't `key: value` lines, such as a gradient's `Def` string. */
    body: string[];
}

export interface ParseResult {
    statements: Statement[];
    definitions: Definition[];
    diagnostics: Diagnostic[];
}

/** Verbs whose argument is free text rather than a subject and clauses. */
const TEXT_VERBS = new Set(['hint', 'branch', 'strategy', 'thumbnail']);
const VERBS = new Set(['keyframe', 'skip', 'thumbnail', 'hint', 'branch', 'strategy', 'actor', 'marker', 'tether', 'status', 'aoe', 'effect', 'set', 'depart', 'arrive', 'move', 'follow', 'turn']);
const VERB_LINE = /^([+-]?)([a-z][a-z-]*)(:)?(?:\s+(.*))?$/;
const DEFINE_LINE = /^define\s+(?:(element|action|gradient|strategy)\s+)?(\S+)$/;
const FIELD_LINE = /^([a-zA-Z][\w-]*):\s*(.*)$/;

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

    const add = (line: number, text: string) => {
        if (verb == null) {
            diagnostics.push({ line, message: `"${text}" has no verb to continue` });
            return;
        }

        const statement: Statement = { line, at, sign: verb.sign, verb: verb.name, text, subjects: [], clauses: [] };

        if (!TEXT_VERBS.has(verb.name) && text !== '') {
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
            // Read as an element anyway, so that the one mistake doesn't also report everything that refers to it.
            if (define[1] == null) diagnostics.push({ line, message: `"define ${define[2]}" needs a kind: define element, action, gradient or strategy` });

            definition = { line, kind: (define[1] as Definition['kind'] | undefined) ?? 'element', id: define[2]!, fields: {}, body: [] };
            definitions.push(definition);
            field = null;
            verb = null;
            return;
        }

        if (definition != null && /^\s/.test(raw)) {
            const match = FIELD_LINE.exec(text);

            // `+effect: laser` under `exit` belongs to that field; only an unsigned word starts a new one.
            if (match != null && definition.kind !== 'gradient') {
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
            add(line, match[4] ?? '');
            return;
        }

        add(line, text);
    });

    return { statements, definitions, diagnostics };
}
