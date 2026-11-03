import { InlayHint, Range, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { getStatusIcon } from './tooltip';
import { OutlineParams, StatusIcon } from './types/outline';
import { getIfType, getStatus, PLACEHOLDER_REGEX } from './util';

/** The stack count suffix (`:<n>`) at the start of what follows the key of a placeholder, as opposed to a duration (`:<n>s`). */
const STACKS_REGEX = /^:(\d+)(?=[:\])])/;

/** What reserves room for a status icon: blank, and wider than the icon at any inlay hint font size up to the editor's. */
const ICON_SPACER = '   ';

/**
 * Blank inlay hints at `icons`, inside of `range`. Word wrap ignores the width of decorations and only counts
 * injected text, and inlay hints are the only injected text that extensions can add. The client draws the icons over them.
 */
export function iconSpacers(icons: StatusIcon[] | null, range: Range): InlayHint[] {
    return (icons ?? [])
        .filter(icon => icon.range.start.line >= range.start.line && icon.range.start.line <= range.end.line)
        .map(icon => ({ position: icon.range.start, label: ICON_SPACER }));
}

/**
 * The in-game icons of the statuses in a timeline file: one after the colon of each key in `status`,
 * one in front of each status of an action's `inflicts`, and one in front of each `s:` placeholder,
 * which shows the icon for its stack count. Empty if game data is off, `null` if the file isn't a timeline.
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

            if (typeof id === 'number') {
                addId(offset, id, yaml.isMap(value) ? value.get('icon') : undefined, stacks);
            }
        }

        /** Adds the icon of the game status `id` at `offset`, or `icon` if the timeline overrides it. */
        function addId(offset: number, id: number, icon: unknown, stacks: number): void {
            const position = textDocument!.positionAt(offset);

            icons.push(getStatusIcon(id, icon, stacks)
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

        for (const action of getIfType(document, 'actions', yaml.isMap)?.items ?? []) {
            const inflicts = yaml.isMap(action.value) ? getIfType(action.value, 'inflicts', yaml.isSeq) : null;

            for (const inflicted of inflicts?.items ?? []) {
                const status = yaml.isMap(inflicted) ? inflicted.get('status', true) : null;

                if (yaml.isScalar(status) && typeof status.value === 'string' && status.range != null) {
                    add(status.range[0], status.value, 1);
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
