import * as fs from 'fs';
import * as paths from 'path';
import { fileURLToPath } from 'url';
import { Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { getNodeAt, NodeWrapper } from './util';

type Schema = Record<string, any>;

/** The schemas read so far, by path, with the modification time they were read at. */
const schemas = new Map<string, { mtimeMs: number, schema: Schema | null }>();

/** The timeline schema next to the timeline at `uri` (`<data>/schemas/raid.schema.json` for `<data>/<folder>/<file>.yaml`), or `null`. */
function raidSchemaOf(uri: string): Schema | null {
    if (!uri.startsWith('file:')) {
        return null;
    }

    const path = paths.join(paths.dirname(paths.dirname(fileURLToPath(uri))), 'schemas', 'raid.schema.json');
    let mtimeMs: number;

    try {
        mtimeMs = fs.statSync(path).mtimeMs;
    } catch {
        return null;
    }

    let cached = schemas.get(path);

    if (cached?.mtimeMs !== mtimeMs) {
        let schema: Schema | null;

        try {
            schema = JSON.parse(fs.readFileSync(path, 'utf-8'));
        } catch {
            schema = null;
        }

        cached = { mtimeMs, schema };
        schemas.set(path, cached);
    }

    return cached.schema;
}

/** `schema` with its `$ref` followed and its `anyOf`, `oneOf` and `allOf` branches spread, as a list of plain schemas. */
function expand(root: Schema, schema: unknown, depth: number = 0): Schema[] {
    if (schema == null || typeof schema !== 'object' || depth > 32) {
        return [];
    }

    const s = schema as Schema;

    if (typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
        const target = s.$ref.slice(2).split('/').reduce<unknown>((node, key) => (node as Schema | undefined)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);

        return expand(root, target, depth + 1);
    }

    const branches = [...s.anyOf ?? [], ...s.oneOf ?? [], ...s.allOf ?? []];

    return [s, ...branches.flatMap(branch => expand(root, branch, depth + 1))];
}

/** The keys (and, for list entries, `0`) from the document's root down to `wrapper`. */
function pathOf(wrapper: NodeWrapper): (string | number)[] {
    const path: (string | number)[] = [];

    for (let current: NodeWrapper | undefined = wrapper; current?.parent != null; current = current.parent) {
        const parent = current.parent.node;

        if (yaml.isPair(parent) && yaml.isScalar(parent.key)) {
            path.unshift(String(parent.key.value));
        } else if (yaml.isSeq(parent)) {
            path.unshift(0);
        }
    }

    return path;
}

/** The string values the schema `root` allows at `path` with an `enum` or `const`, or `null` if it doesn't limit them. */
function enumAt(root: Schema, path: (string | number)[]): Set<string> | null {
    let current: Schema[] = [root];

    for (const segment of path) {
        current = current.flatMap(schema => expand(root, schema)).flatMap(schema => {
            if (typeof segment === 'number') {
                return schema.items != null ? [schema.items] : [];
            }

            if (schema.properties?.[segment] != null) {
                return [schema.properties[segment]];
            }

            const patterns = Object.entries((schema.patternProperties ?? {}) as Record<string, Schema>).filter(([pattern]) => new RegExp(pattern, 'u').test(segment));

            if (patterns.length > 0) {
                return patterns.map(([, value]) => value);
            }

            return typeof schema.additionalProperties === 'object' ? [schema.additionalProperties] : [];
        });
    }

    const values = current.flatMap(schema => expand(root, schema)).flatMap(schema => schema.enum ?? (schema.const !== undefined ? [schema.const] : []));
    const strings = values.filter((value): value is string => typeof value === 'string');

    return strings.length > 0 ? new Set(strings) : null;
}

/**
 * The values that `raid.schema.json` suggests itself for the value at `position` of the timeline `document`, through
 * the YAML extension: the `enum` of the property there. `null` if it suggests none, or the schema can't be read.
 */
export function schemaEnumAt(document: yaml.Document, textDocument: TextDocument, position: Position): Set<string> | null {
    const schema = raidSchemaOf(textDocument.uri);
    const result = schema != null ? getNodeAt(document, textDocument, position) : null;

    if (schema == null || result == null || !yaml.isScalar(result.node) || (yaml.isPair(result.parent?.node) && result.node === result.parent.node.key)) {
        return null;
    }

    return enumAt(schema, pathOf(result));
}
