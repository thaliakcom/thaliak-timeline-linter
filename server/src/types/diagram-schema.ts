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
