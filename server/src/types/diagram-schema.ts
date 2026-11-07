import { TYPES_OF_KIND } from '../utility/diagram-ddl/compile';
import { Definition } from '../utility/diagram-ddl/parse';
import { DDL_MARKER_LOOKS, SHAPE_TYPES } from '../utility/diagram-enums';

/** A field of a `define` block in `schemas/diagram.schema.json`. */
export interface DiagramField {
    type: DiagramValueType | DiagramValueType[];
    description: string;
    /** The values it can have, with what each means. */
    values?: Record<string, string>;
    /** Where its values are listed instead: paths in the schema, such as `looks.aoes`. */
    valuesFrom?: string[];
    /** What its value names. */
    reference?: 'element';
}

/** `point` is a fixed-size list of numbers, written like a coordinate: `(0.5, 0)`. */
export type DiagramValueType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'point';

/** A kind of `define` block in `schemas/diagram.schema.json`. */
export interface DiagramDefineKind {
    description: string;
    fields: Record<string, DiagramField>;
}

/** The vocabulary of `.diagram` files, from `schemas/diagram.schema.json`. */
export interface DiagramSchema {
    /** By the word as it's written, with its sign. */
    verbs: Record<string, {
        description: string;
        /** What follows the verb. Without one, it stands alone. */
        arguments?: 'text' | 'subjects';
        clauses?: string[];
    }>;
    clauses: Record<string, {
        description: string;
        /** What its value names, if anything. */
        takes?: 'element';
    }>;
    placeholders: Record<string, string>;
    define: {
        description: string;
        gradient: { description: string };
        strategy: DiagramDefineKind;
        action: DiagramDefineKind;
        /** The fields that every element kind ({@link ELEMENT_KINDS}) has. */
        element: DiagramDefineKind;
    } & Record<typeof ELEMENT_KINDS[number], { description: string, fields?: Record<string, DiagramField> }>;
    looks: Record<'aoes' | 'tethers' | 'markers', Record<string, string>>;
    animations: {
        enter: Record<string, string>;
        exit: Record<string, string>;
        /** The element types each animation is allowed on: all of them, only shapes, or a list of types. */
        elements: Record<'enter' | 'exit', Record<string, 'all' | 'shapes' | string[]>>;
    };
}

/** The `define` kinds of elements. Their fields are `define.element`'s, plus their own. */
export const ELEMENT_KINDS = ['arena', 'actor', 'object', 'puddle', 'tether'] as const;
/** Every `define` kind, as the parser knows them, except the removed `element`. */
export const DEFINE_KINDS = [...ELEMENT_KINDS, 'action', 'gradient', 'strategy'] as const;
/** The element fields that `define action` can't have, since its timeline action decides them (thaliak's `MOVED_KEYS`). */
const ACTION_TIMELINE_KEYS = new Set(['type', 'size', 'angle', 'look']);

/** The fields a `define` block of `kind` can have. Only an action's has the action fields; the removed `element` has the shared ones. */
export function fieldsOfKind(schema: DiagramSchema, kind: string): Record<string, DiagramField> {
    switch (kind) {
        case 'gradient': return {};
        case 'strategy': return schema.define.strategy.fields;
        case 'action': return Object.fromEntries(Object.entries({ ...schema.define.action.fields, ...schema.define.element.fields }).filter(([key]) => !ACTION_TIMELINE_KEYS.has(key)));
        default: return { ...schema.define.element.fields, ...(schema.define[kind as typeof ELEMENT_KINDS[number]]?.fields ?? {}) };
    }
}

/** The values and their meanings that `field` lists itself or through `valuesFrom`. */
export function valuesOf(schema: DiagramSchema, field: DiagramField): Record<string, string> {
    const lists = (field.valuesFrom ?? []).map(path => path.split('.').reduce<any>((value, key) => value?.[key], schema) as Record<string, string> | undefined);

    return Object.assign({}, field.values, ...lists);
}

/** The element fields that only some types have, by those types, as the schema describes them. */
const FIELDS_OF_TYPES: Record<string, readonly string[]> = {
    image: ['image'],
    shape: ['image'],
    angle: ['cone'],
    fade: ['rectangle'],
    depth: ['prism'],
    width: ['link'],
    // An image has no look, and the colour of a shape or a tether is its look's (`validateDefinitions()`).
    look: [...SHAPE_TYPES, 'graphic', 'link'],
    color: ['image', 'graphic', 'prism']
};
/** The element fields that only some kinds have, by those kinds, as the schema describes them. */
const FIELDS_OF_KINDS: Record<string, readonly string[]> = { margin: ['arena'], speed: ['actor'], reach: ['actor'] };

/**
 * The element types an action's AoE can be drawn as, by its timeline `shape` (the compiler's `drawnShape()`). Where
 * game data decides between two, both. Composite shapes are drawn as rectangles.
 */
const TYPES_OF_SHAPE: Record<string, readonly string[]> = {
    chariot: ['ellipse'], defamation: ['ellipse'], dynamo: ['donut'], cone: ['cone'], line: ['rectangle'], rect: ['rectangle'],
    halfroom: ['cone', 'rectangle'], 'in-or-out': ['ellipse', 'donut'],
    plus: ['rectangle'], cross: ['rectangle'], star: ['rectangle'], sides: ['rectangle'], grid: ['rectangle']
};

/**
 * The element types a `define` block can draw: the `type` it has, or else every type of its kind (the compiler's
 * `TYPES_OF_KIND`). An action draws the shapes its timeline action's `shape` can be, or any shape if that's unknown,
 * and the other kinds nothing.
 */
export function typesOfBlock(kind: string, type: string | undefined, shape?: string): readonly string[] {
    if (kind === 'action') return (shape != null ? TYPES_OF_SHAPE[shape] : undefined) ?? SHAPE_TYPES;

    const allowed = TYPES_OF_KIND[kind as Definition['kind']] ?? [];

    return type != null && allowed.includes(type) ? [type] : allowed;
}

/** The fields worth suggesting in a block of `kind` that draws one of `types`: those of {@link fieldsOfKind} that it can use. */
export function suggestedFieldsOf(schema: DiagramSchema, kind: string, types: readonly string[]): Record<string, DiagramField> {
    // A kind with one type implies it (the arena and tethers), so writing it changes nothing.
    const impliesType = TYPES_OF_KIND[kind as Definition['kind']]?.length === 1;

    return Object.fromEntries(Object.entries(fieldsOfKind(schema, kind)).filter(([key]) =>
        !(key === 'type' && impliesType) && (FIELDS_OF_KINDS[key]?.includes(kind) ?? true) && (FIELDS_OF_TYPES[key]?.some(type => types.includes(type)) ?? true)));
}

/**
 * The values worth suggesting for the field `key` of a block of `kind` that draws one of `types`: only its kind's types,
 * the looks of those types, and the animations they can play.
 */
export function suggestedValuesOf(schema: DiagramSchema, kind: string, types: readonly string[], key: string, field: DiagramField): Record<string, string> {
    const values = valuesOf(schema, field);
    const only = (keys: Iterable<string>) => Object.fromEntries([...new Set(keys)].filter(value => values[value] != null).map(value => [value, values[value]!]));

    switch (key) {
        case 'type':
            return kind === 'action' ? {} : only(TYPES_OF_KIND[kind as Definition['kind']] ?? []);
        case 'look':
            return only(types.flatMap(type => SHAPE_TYPES.includes(type) ? Object.keys(schema.looks.aoes)
                : type === 'link' ? Object.keys(schema.looks.tethers)
                : type === 'graphic' ? DDL_MARKER_LOOKS.graphics
                : []));
        case 'enter':
        case 'exit': {
            const allowed = schema.animations.elements[key];

            return only(Object.keys(values).filter(name => {
                const on = allowed[name];

                return on == null || on === 'all' || types.some(type => on === 'shapes' ? SHAPE_TYPES.includes(type) : on.includes(type === 'graphic' ? 'marker' : type));
            }));
        }
        default:
            return values;
    }
}
