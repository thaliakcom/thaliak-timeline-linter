import * as fs from 'fs';
import * as paths from 'path';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { MEDIA } from './tooltip';
import { OutlineParams, StatusIcon } from './types/outline';
import { HEADMARKER_ICONS, ICONS, perPrefix, PLACEHOLDER_REGEX } from './util';

/** The first of `files` that exists, or `null`. */
function existing(...files: string[]): string | null {
    return files.find(file => fs.existsSync(file)) ?? null;
}

/**
 * The image an `i:` or `hm:` placeholder shows, or `null` if it has none: thaliak's sub-icon (`media/sub-icons`,
 * SVG or PNG) or headmarker (`media/markers`), both fetched by `get-objects.mjs`.
 */
function subIconPath(reference: string): string | null {
    return perPrefix<string | null>(reference, {
        'i:': key => ICONS.includes(key as typeof ICONS[number]) ? existing(paths.join(MEDIA, 'sub-icons', `${key}.svg`), paths.join(MEDIA, 'sub-icons', `${key}.png`)) : null,
        'hm:': key => HEADMARKER_ICONS.includes(key) ? existing(paths.join(MEDIA, 'markers', `${key}.svg`)) : null
    });
}

/**
 * The icons of a timeline file's `i:` sub-icon and `hm:` headmarker placeholders, one in front of each. `null` if
 * the file isn't a timeline.
 */
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
