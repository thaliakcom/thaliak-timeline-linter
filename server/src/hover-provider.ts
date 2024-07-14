import { Hover, HoverParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';
import { getSymbolAt, perPrefix, SPECIAL_TIMELINE_IDS } from './util';

function makeDescription(name: string, description: string): string {
    return `## ${name}\n\n${description}`;
}

export default function hoverProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: HoverParams) => Hover | null {
    return (params) => {
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
        const actions = raidData?.actions;
        const status = raidData?.status;
        const enums = documentCache.getLinterOptions(settings).enums;

        return perPrefix(key, {
            'a:': key => {
                const action = actions?.[key];

                if (action != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(key, action.description) }, range };
                } else if (enums.common != null && enums.common.yaml.actions[key] != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(key, 'Common action (`enums/common.yaml`).') }, range };
                } else if (result.delimiter == null) {
                    const specialTimelineItem = SPECIAL_TIMELINE_IDS.find(x => x.id === key);

                    if (specialTimelineItem != null) {
                        return { contents: { kind: 'markdown', value: makeDescription('\\' + key, specialTimelineItem.description) }, range };
                    }
                }
            },
            's:': key => {
                const item = status?.[key];

                if (item != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(key, item.description ?? 'Status effect.') }, range };
                } else if (enums.common != null && enums.common.yaml.status[key] != null) {
                    return { contents: { kind: 'markdown', value: makeDescription(key, 'Common status (`enums/common.yaml`).') }, range };
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
        }) ?? null;
    };
}
