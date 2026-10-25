import { InlayHint, InlayHintParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { getIfType } from './util';

/** Formats milliseconds as `m:ss.mmm`, like fflogs. */
function formatTime(ms: number): string {
    const sign = ms < 0 ? '-' : '';
    const abs = Math.abs(ms);
    const minutes = Math.floor(abs / 60000);
    const seconds = Math.floor(abs % 60000 / 1000).toString().padStart(2, '0');
    const millis = Math.round(abs % 1000).toString().padStart(3, '0');

    return `${sign}${minutes}:${seconds}.${millis}`;
}

/** Shows the `at` of timeline items as a timestamp (children's as an offset with `+`, since theirs is relative to the parent). */
export default function inlayHintProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: InlayHintParams) => InlayHint[] {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri);
        const document = textDocument != null ? documentCache.get(textDocument) : null;

        if (textDocument == null || document == null) {
            return [];
        }

        const start = textDocument.offsetAt(params.range.start);
        const end = textDocument.offsetAt(params.range.end);
        const hints: InlayHint[] = [];
        const inRange = (range: yaml.Range | null | undefined): range is yaml.Range => range != null && range[1] >= start && range[0] <= end;

        function addTimestamps(items: yaml.YAMLSeq, prefix: string): void {
            for (const item of items.items) {
                const at = yaml.isMap(item) ? item.get('at', true) : null;

                if (yaml.isScalar(at) && typeof at.value === 'number' && inRange(at.range)) {
                    hints.push({ position: textDocument!.positionAt(at.range[1]), label: prefix + formatTime(at.value), paddingLeft: true });
                }
            }
        }

        const timeline = getIfType(document, 'timeline', yaml.isSeq);

        if (timeline != null) {
            addTimestamps(timeline, '');
        }

        for (const action of getIfType(document, 'actions', yaml.isMap)?.items ?? []) {
            const children = yaml.isMap(action.value) ? getIfType(action.value, 'children', yaml.isSeq) : null;

            if (children != null) {
                addTimestamps(children, '+');
            }
        }

        return hints;
    };
}
