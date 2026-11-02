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

export type DiagramValueType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';

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
        element: DiagramDefineKind;
    };
    looks: Record<'aoes' | 'tethers' | 'markers', Record<string, string>>;
    animations: {
        enter: Record<string, string>;
        exit: Record<string, string>;
        /** The element types each animation is allowed on: all of them, only shapes, or a list of types. */
        elements: Record<'enter' | 'exit', Record<string, 'all' | 'shapes' | string[]>>;
    };
}

/** The values and their meanings that `field` lists itself or through `valuesFrom`. */
export function valuesOf(schema: DiagramSchema, field: DiagramField): Record<string, string> {
    const lists = (field.valuesFrom ?? []).map(path => path.split('.').reduce<any>((value, key) => value?.[key], schema) as Record<string, string> | undefined);

    return Object.assign({}, field.values, ...lists);
}
