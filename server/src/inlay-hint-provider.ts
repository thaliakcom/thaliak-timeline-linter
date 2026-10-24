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

/** Shows the `at` of top-level timeline items as a timestamp. Children are left out: their `at` is relative to the parent. */
export default function inlayHintProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: InlayHintParams) => InlayHint[] {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri);
        const document = textDocument != null ? documentCache.get(textDocument) : null;
        const timeline = getIfType(document, 'timeline', yaml.isSeq);

        if (textDocument == null || timeline == null) {
            return [];
        }

        const start = textDocument.offsetAt(params.range.start);
        const end = textDocument.offsetAt(params.range.end);
        const hints: InlayHint[] = [];

        for (const item of timeline.items) {
            const at = yaml.isMap(item) ? item.get('at', true) : null;

            if (yaml.isScalar(at) && typeof at.value === 'number' && at.range != null && at.range[1] >= start && at.range[0] <= end) {
                hints.push({ position: textDocument.positionAt(at.range[1]), label: formatTime(at.value), paddingLeft: true });
            }
        }

        return hints;
    };
}
