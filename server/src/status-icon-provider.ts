import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { getStatusIcon } from './tooltip';
import { OutlineParams, StatusIcon } from './types/outline';
import { getIfType, getStatus, PLACEHOLDER_REGEX } from './util';

/** The stack count suffix (`:<n>`) at the start of what follows the key of a placeholder, as opposed to a duration (`:<n>s`). */
const STACKS_REGEX = /^:(\d+)(?=[:\])])/;

/**
 * The in-game icons of the statuses in a timeline file: one after the colon of each key in `status`
 * and one in front of each `s:` placeholder, which shows the icon for its stack count. Empty if game
 * data is off, `null` if the file isn't a timeline.
 */
export default function statusIconProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: OutlineParams) => Promise<StatusIcon[] | null> {
    return async (params) => {
        const textDocument = documents.get(params.uri);
        const document = textDocument != null ? documentCache.get(textDocument) : null;

        if (textDocument == null || document == null || !yaml.isMap(document.contents)) {
            return null;
        }

        const common = documentCache.getLinterOptions(settings).enums.common;
        const icons: Promise<StatusIcon | null>[] = [];

        /** Adds the icon of the status `key` (from the timeline or `common.yaml`) at `offset`. */
        function add(offset: number, key: string, stacks: number): void {
            const value = getStatus(document!, key)?.value;
            const id = yaml.isMap(value) ? value.get('id') : common?.yaml.status[key];

            if (typeof id !== 'number') {
                return;
            }

            const position = textDocument!.positionAt(offset);

            icons.push(getStatusIcon(id, yaml.isMap(value) ? value.get('icon') : undefined, stacks)
                .then(icon => icon != null ? { range: { start: position, end: position }, path: icon.path } : null));
        }

        const text = textDocument.getText();

        for (const pair of getIfType(document, 'status', yaml.isMap)?.items ?? []) {
            if (yaml.isScalar(pair.key) && pair.key.range != null && yaml.isMap(pair.value)) {
                const id = getIfType(pair.value, 'id', yaml.isScalar);

                if (id?.range != null) {
                    add(id.range[0], String(pair.key.value), 1);
                }
            }
        }

        for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
            const reference = match[1] ?? match[2];

            if (!reference.startsWith('s:')) {
                continue;
            }

            const suffix = match[0].slice(match[0].lastIndexOf(reference) + reference.length);
            const stacks = STACKS_REGEX.exec(suffix)?.[1];

            add(match.index, reference.slice('s:'.length), stacks != null ? Number.parseInt(stacks) : 1);
        }

        return (await Promise.all(icons)).filter(icon => icon != null);
    };
}
