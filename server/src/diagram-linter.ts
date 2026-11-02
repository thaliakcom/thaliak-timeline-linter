// Diagnostics of `.diagram` files: whatever thaliak's build would report, plus the checks of what `define` blocks draw.
import { Diagnostic, DiagnosticSeverity, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { diagramInputOf, DefinitionField, fieldsOf, hasBalancedBrackets, isDiagramWip, linesOf, timelineOf } from './diagram-context';
import { LinterOptions } from './server';
import { DiagramField, DiagramSchema, DiagramValueType } from './types/diagram-schema';
import { compileDiagram } from './utility/diagram-ddl/compile';
import { Definition, parse } from './utility/diagram-ddl/parse';

/** The element IDs that mean something by themselves, and so can't be defined. `boss`, `enemy` and `arena` can. */
const RESERVED_ELEMENTS = new Set(['players', 'DPS', 'tanks', 'healers', 'supports', 'T1', 'T2', 'H1', 'H2', 'M1', 'M2', 'R1', 'R2', 'cast', 'hint', 'marker-a', 'marker-1', 'marker-b', 'marker-2', 'marker-c', 'marker-3', 'marker-d', 'marker-4']);
/** The diagram element types that `shapes` in the schema's `animations.elements` refers to. */
const SHAPE_TYPES: string[] = ['donut', 'ellipse', 'cone', 'rectangle'];

function diagnostic(severity: DiagnosticSeverity, code: string, message: string, line: number, start: number = 0, end: number = Number.MAX_SAFE_INTEGER): Diagnostic {
    return { source: 'thaliak', severity, code, message, range: { start: { line, character: start }, end: { line, character: end } } };
}

/** A field's value parsed the way the compiler parses it. `undefined` if it can't be. */
function valueOf(fields: DefinitionField[], key: string): unknown {
    const lines = fields.filter(field => field.key === key).map(field => field.value);

    try {
        return lines.length > 0 ? yaml.parse(lines.join(' ')) : undefined;
    } catch {
        return undefined;
    }
}

/** The type of a look or animation given as its name (`look: ripple`) or as `{ type, ...parameters }`. */
function typeOf(value: unknown): string | undefined {
    const type = value != null && typeof value === 'object' ? (value as { type?: unknown }).type : value;

    return typeof type === 'string' ? type : undefined;
}

/**
 * The checks of what `define` blocks draw, which `processGraphing()` in thaliak's `data.ts` and the viewer rely on,
 * except for those that need game data or an arena image's size. An action's block draws the element its `telegraph` names.
 */
function* validateDefinitions(definitions: Definition[], lines: string[], options: LinterOptions): Generator<Diagnostic> {
    const schema = options.diagramSchema;
    const looks = schema != null ? { aoes: Object.keys(schema.looks.aoes), tethers: Object.keys(schema.looks.tethers), markers: Object.keys(schema.looks.markers) } : undefined;
    const animations = schema?.animations.elements;
    const blocks = definitions.filter(definition => definition.kind === 'element').map(definition => ({ definition, fields: fieldsOf(definition, lines) }));

    if (schema != null) {
        yield* validateFields(definitions, lines, schema);
    }

    const types = new Map(blocks.map(({ definition, fields }) => [definition.id, typeOf(valueOf(fields, 'type'))]));

    for (const { definition, fields } of blocks) {
        const telegraph = valueOf(fields, 'telegraph');
        const type = types.get(definition.id) ?? (typeof telegraph === 'string' ? types.get(telegraph) : undefined);
        const firstOf = (key: string) => fields.find(field => field.key === key);
        const error = (code: string, field: DefinitionField, message: string) => diagnostic(DiagnosticSeverity.Error, code, message, field.line, field.start);

        if (RESERVED_ELEMENTS.has(definition.id)) {
            yield diagnostic(DiagnosticSeverity.Error, 'reserved-graphing-element', `'${definition.id}' is a reserved element.`, definition.line - 1);
        }

        const size = valueOf(fields, 'size');

        if (type === 'donut' && Array.isArray(size) && typeof size[0] === 'number' && typeof size[1] === 'number' && size[0] >= size[1]) {
            yield error('invalid-donut-size', firstOf('size')!, `Donut size [${size[0]}, ${size[1]}] must be [inner diameter, outer diameter].`);
        }

        for (const key of ['enter', 'exit'] as const) {
            const field = fields.find(x => x.key === key && !/^[+-]/.test(x.value) && x.value !== '');
            const name = field != null ? typeOf(key === 'exit' ? valueOf(fields.filter(x => x.key === key && !/^[+-]/.test(x.value)), key) : valueOf(fields, key)) : undefined;
            const allowed = name != null ? animations?.[key]?.[name] : undefined;

            if (allowed != null && allowed !== 'all' && !(allowed === 'shapes' ? SHAPE_TYPES.includes(type ?? 'image') : allowed.includes(type ?? 'image'))) {
                yield error('invalid-animation', field!, `'${key}: ${name}' is only allowed on ${allowed === 'shapes' ? 'shapes' : allowed.join(', ')}, but '${definition.id}' has type ${type ?? 'image'}.`);
            }
        }

        const look = typeOf(valueOf(fields, 'look'));

        if (type === 'link' && firstOf('width') != null && (look ?? 'plain') !== 'plain') {
            yield error('ignored-by-look', firstOf('width')!, `'width' is ignored with 'look: ${look}'; remove it or use 'look: plain'.`);
        }

        if (type != null && (SHAPE_TYPES.includes(type) || type === 'link') && firstOf('color') != null) {
            yield error('color-in-look', firstOf('color')!, `'color' moved into the look: 'look: { type: plain, color: ${firstOf('color')!.value} }'.`);
        }

        if (type != null && look != null) {
            const list = SHAPE_TYPES.includes(type) ? 'aoes' : type === 'link' ? 'tethers' : type === 'marker' ? 'markers' : undefined;

            if (list == null) {
                yield error('invalid-look', firstOf('look')!, `${type} elements have no look.`);
            } else if (looks != null && !looks[list].includes(look)) {
                yield error('invalid-look', firstOf('look')!, `'${look}' isn't one of the ${list}: '${looks[list].join('\', \'')}'`);
            }
        }

        const image = valueOf(fields, 'image');
        const marker = typeof image === 'string' ? /^\/images\/(?:markers|other)\/([a-z-]+)\.svg$/.exec(image)?.[1] : undefined;

        if (marker != null && looks != null && looks.markers.includes(marker)) {
            yield error('marker-image', firstOf('image')!, `${image} is a marker; use 'type: marker' with 'look: ${marker}'.`);
        }

        if (firstOf('margin') != null && definition.id !== 'arena') {
            yield error('invalid-margin', firstOf('margin')!, `Only the arena can have a margin.`);
        }
    }

    yield* validateFieldOrder(blocks.map(block => block.fields));
}

/** The name of a value's type, as the schema names it. */
function valueTypeOf(value: unknown): DiagramValueType {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as DiagramValueType;
}

/** Warns about the fields of `define` blocks that `schema` doesn't know, and values that aren't what it says. */
function* validateFields(definitions: Definition[], lines: string[], schema: DiagramSchema): Generator<Diagnostic> {
    for (const definition of definitions) {
        if (definition.kind === 'gradient') {
            continue;
        }

        const known: Record<string, DiagramField> = definition.kind === 'strategy' ? schema.define.strategy.fields : { ...schema.define.action.fields, ...schema.define.element.fields };
        const fields = fieldsOf(definition, lines);

        for (const key of new Set(fields.map(field => field.key))) {
            const first = fields.find(field => field.key === key)!;
            const spec = known[key];
            const warn = (code: string, message: string) => diagnostic(DiagnosticSeverity.Warning, code, message, first.line, first.start);

            if (spec == null) {
                yield warn('unknown-field', `'${key}' isn't a field of ${definition.kind} definitions.`);
                continue;
            }

            // `exit` also holds statements, which aren't values.
            const own = fields.filter(field => field.key === key && !/^[+-]/.test(field.value));

            if (own.length === 0 || own.every(field => field.value === '')) {
                continue;
            }

            const value = valueOf(own, key);
            const types = [spec.type].flat();

            if (value !== undefined && !types.includes(valueTypeOf(value))) {
                yield warn('invalid-field-type', `'${key}' takes ${types.join(' or ')}, not ${valueTypeOf(value)}.`);
            } else if (spec.values != null && typeof value === 'string' && spec.values[value] == null) {
                yield warn('invalid-field-value', `'${value}' isn't one of the values of '${key}': '${Object.keys(spec.values).join('\', \'')}'`);
            }
        }
    }
}

/** Warns about fields that come after a field that an earlier block has after them, so every block follows one order. */
function* validateFieldOrder(blocks: DefinitionField[][]): Generator<Diagnostic> {
    /** For every field, the fields seen after it. */
    const successors = new Map<string, Set<string>>();
    const comesAfter = (a: string, b: string, seen: Set<string> = new Set()): boolean => {
        for (const next of successors.get(b) ?? []) {
            if (next === a || (!seen.has(next) && seen.add(next) != null && comesAfter(a, next, seen))) {
                return true;
            }
        }

        return false;
    };

    for (const fields of blocks) {
        const keys = fields.filter((field, i) => fields.findIndex(x => x.key === field.key) === i);

        for (const [i, field] of keys.entries()) {
            const target = keys.slice(0, i).find(earlier => comesAfter(earlier.key, field.key));

            if (target != null) {
                yield diagnostic(DiagnosticSeverity.Warning, 'inconsistent-prop-order/element-definition', `The order of this '${field.key}' is inconsistent: it should come before '${target.key}'.`, field.line, field.start);
            }
        }

        // Only relations that don't contradict earlier blocks, so that every warning can be resolved.
        for (const [i, field] of keys.entries()) {
            for (const later of keys.slice(i + 1)) {
                if (!comesAfter(field.key, later.key)) {
                    if (!successors.has(field.key)) successors.set(field.key, new Set());

                    successors.get(field.key)!.add(later.key);
                }
            }
        }
    }
}

/** Everything wrong with the `.diagram` file `textDocument`. Errors of a fight with `wip: [diagrams]` are warnings, as thaliak's build doesn't report them. */
export async function lintDiagram(textDocument: TextDocument, documents: TextDocuments<TextDocument>, options: LinterOptions): Promise<Diagnostic[]> {
    const source = textDocument.getText();
    const parsed = parse(source);
    const lines = linesOf(source);
    const timeline = timelineOf(documents, textDocument.uri);
    const severity = timeline != null && isDiagramWip(timeline) ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;
    const found: Diagnostic[] = [];
    /** A diagnostic of the compiler, at the line's text. Line 0 is the whole file. */
    const report = (line: number, message: string) => {
        const text = lines[Math.max(line - 1, 0)] ?? '';

        found.push(diagnostic(severity, 'diagrams', message, Math.max(line - 1, 0), text.length - text.trimStart().length, text.trimEnd().length));
    };

    if (timeline == null) {
        parsed.diagnostics.forEach(({ line, message }) => report(line, message));
    } else {
        const { input, problems } = await diagramInputOf(timeline, textDocument.uri);

        problems.forEach(message => found.push(diagnostic(DiagnosticSeverity.Warning, 'diagrams', message, 0)));

        // A half-typed `[` would stop the compiler altogether, and with it every other diagnostic.
        const complete = lines.map((text, i) => {
            if (hasBalancedBrackets(text)) {
                return text;
            }

            report(i + 1, `A "[" or "]" is missing its other half.`);
            return '';
        }).join('\n');

        try {
            compileDiagram(complete, input).diagnostics.forEach(({ line, message }) => report(line, message));
        } catch (e) {
            // Half-typed lines can break what the compiler assumes the parser has checked.
            report(0, `The diagram can't be compiled: ${e instanceof Error ? e.message : e}`);
        }
    }

    found.push(...validateDefinitions(parsed.definitions, lines, options));

    return found;
}
