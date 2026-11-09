import * as fs from 'fs';
import * as paths from 'path';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { MEDIA } from './tooltip';
import { OutlineParams, StatusIcon } from './types/outline';
import { perPrefix, PLACEHOLDER_REGEX } from './util';

/** An icon an `i:` placeholder can show. */
export interface Icon {
    /** The image file. */
    readonly path: string;
    /** What kind of icon it is, e.g. `role icon`. */
    readonly category: string;
}

/** The category of the icons in each subfolder of `media/icons`. Other subfolders use their name. */
const ICON_CATEGORIES: Record<string, string> = {
    roles: 'role icon',
    headmarkers: 'headmarker'
};

let icons: Map<string, Icon> | undefined;

/**
 * The icons an `i:` placeholder can show, by name: the SVG and PNG files in the subfolders of `media/icons`
 * (thaliak's `www/images/icons`, fetched by `get-objects.mjs`). Read once.
 */
export function getIcons(): ReadonlyMap<string, Icon> {
    if (icons == null) {
        icons = new Map();
        const root = paths.join(MEDIA, 'icons');

        for (const folder of fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []) {
            if (!folder.isDirectory()) {
                continue;
            }

            for (const file of fs.readdirSync(paths.join(root, folder.name))) {
                const match = /^(.+)\.(?:svg|png)$/.exec(file);

                if (match != null && !icons.has(match[1]!)) {
                    icons.set(match[1]!, { path: paths.join(root, folder.name, file), category: ICON_CATEGORIES[folder.name] ?? folder.name });
                }
            }
        }
    }

    return icons;
}

/** The image an `i:` placeholder shows, or `null` if it has none. */
function subIconPath(reference: string): string | null {
    return perPrefix<string | null>(reference, {
        'i:': key => getIcons().get(key)?.path ?? null
    });
}

/** The icons of a timeline file's `i:` placeholders, one in front of each. `null` if the file isn't a timeline. */
export function subIconProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache): (params: OutlineParams) => Promise<StatusIcon[] | null> {
    return async (params) => {
        const textDocument = documents.get(params.uri);
        const document = textDocument != null ? documentCache.get(textDocument) : null;

        if (textDocument == null || document == null || !yaml.isMap(document.contents)) {
            return null;
        }

        const icons: StatusIcon[] = [];

        for (const match of textDocument.getText().matchAll(PLACEHOLDER_REGEX)) {
            const path = subIconPath(match[1] ?? match[2]);

            if (path != null) {
                const position = textDocument.positionAt(match.index);
                icons.push({ range: { start: position, end: position }, path });
            }
        }

        return icons;
    };
}
