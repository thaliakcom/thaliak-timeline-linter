import { Hover, HoverParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { actionTooltip, statusTooltip, symbolTooltip, type TooltipContext } from './tooltip';
import { TooltipParams } from './types/outline';
import { UnprocessedRaidData } from './types/raids';
import { getSymbolAt, perPrefix, SPECIAL_TIMELINE_IDS } from './util';

function makeDescription(name: string, description: string): string {
    return `## ${name}\n\n${description}`;
}

/** The tooltip of an action or status in the tree view (`thaliak/tooltip`), the same as its hover. */
export function tooltipProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: TooltipParams) => Promise<string | null> {
    return async (params) => {
        const textDocument = documents.get(params.uri);
        const document = textDocument != null ? documentCache.get(textDocument) : null;

        if (document == null) {
            return null;
        }

        const context: TooltipContext = { raid: document.toJS() as UnprocessedRaidData, enums: documentCache.getLinterOptions(settings).enums };

        return symbolTooltip(context, params.symbol);
    };
}

export default function hoverProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: HoverParams) => Promise<Hover | null> {
    return async (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const document = documentCache.get(textDocument);

        if (document == null) {
            return null;
        }

        const result = getSymbolAt(document, textDocument, params.position);

        if (result == null) {
            return null;
        }

        const { text: key, range } = result;
    
        const raidData = document.toJS() as UnprocessedRaidData;
        const enums = documentCache.getLinterOptions(settings).enums;
        const context: TooltipContext = { raid: raidData, enums };

        return (await perPrefix<Hover | undefined | Promise<Hover | undefined>>(key, {
            'a:': async key => {
                const tooltip = await actionTooltip(context, key);

                if (tooltip != null) {
                    return { contents: { kind: 'markdown', value: tooltip }, range };
                } else if (result.delimiter == null) {
                    const specialTimelineItem = SPECIAL_TIMELINE_IDS.find(x => x.id === key);

                    if (specialTimelineItem != null) {
                        return { contents: { kind: 'markdown', value: makeDescription('\\' + key, specialTimelineItem.description) }, range };
                    }
                }
            },
            's:': async key => {
                const tooltip = await statusTooltip(context, key);

                if (tooltip != null) {
                    return { contents: { kind: 'markdown', value: tooltip }, range };
                }
            },
            't:': key => {
                if (enums.terms != null && enums.terms.yaml[key] != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(key, enums.terms.yaml[key]) }, range };
                }
            },
            'm:': key => {
                if (enums['mechanic-types'] != null && enums['mechanic-types'].yaml[key] != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(enums['mechanic-types'].yaml[key].name, enums['mechanic-types'].yaml[key].description) }, range };
                }
            },
            'ms:': key => {
                if (enums['mechanic-shapes'] != null && enums['mechanic-shapes'].yaml[key] != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(enums['mechanic-shapes'].yaml[key].name, enums['mechanic-shapes'].yaml[key].description) }, range };
                }
            },
            'st:': key => {
                if (enums['status-types'] != null && enums['status-types'].yaml[key] != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(enums['status-types'].yaml[key].name, enums['status-types'].yaml[key].description) }, range };
                }
            },
            'dt:': key => {
                if (enums['damage-types'] != null && enums['damage-types'].yaml[key] != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(enums['damage-types'].yaml[key].name, enums['damage-types'].yaml[key].description) }, range };
                }
            }
        })) ?? null;
    };
}
