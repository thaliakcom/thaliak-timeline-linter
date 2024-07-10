import { Hover, HoverParams, Range, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';
import { getPlaceholderAt } from './util';

function makeDescription(name: string, description: string): string {
    return `## ${name}\n\n${description}`;
}

export default function hoverProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: HoverParams) => Hover | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const result = getPlaceholderAt(textDocument, params.position);

        if (result == null) {
            return null;
        }

        const { text: key, range } = result;
    
        const raidData = (documentCache.get(textDocument)?.toJS() as UnprocessedRaidData | undefined);
        const actions = raidData?.actions;
        const status = raidData?.status;
        const enums = documentCache.getLinterOptions(settings).enums;

        if (key.startsWith('a:')) {
            const innerKey = key.slice(2);
            const action = actions?.[innerKey];

            if (action != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, action.description) }, range };
            } else if (enums.common != null && enums.common.yaml.actions[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, 'Common action (`enums/common.yaml`).') }, range };
            }
        } else if (key.startsWith('s:')) {
            const innerKey = key.slice(2);
            const item = status?.[innerKey];

            if (item != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, item.description ?? 'Status effect.') }, range };
            } else if (enums.common != null && enums.common.yaml.status[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, 'Common status (`enums/common.yaml`).') }, range };
            }
        } else if (key.startsWith('t:')) {
            const innerKey = key.slice(2);

            if (enums.terms != null && enums.terms.yaml[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, enums.terms.yaml[innerKey]) }, range };
            }
        } else if (key.startsWith('m:')) {
            const innerKey = key.slice(2);

            if (enums['mechanic-types'] != null && enums['mechanic-types'].yaml[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(enums['mechanic-types'].yaml[innerKey].name, enums['mechanic-types'].yaml[innerKey].description) }, range };
            }
        } else if (key.startsWith('ms:')) {
            const innerKey = key.slice(3);

            if (enums['mechanic-shapes'] != null && enums['mechanic-shapes'].yaml[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(enums['mechanic-shapes'].yaml[innerKey].name, enums['mechanic-shapes'].yaml[innerKey].description) }, range };
            }
        } else if (key.startsWith('st:')) {
            const innerKey = key.slice(3);

            if (enums['status-types'] != null && enums['status-types'].yaml[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(enums['status-types'].yaml[innerKey].name, enums['status-types'].yaml[innerKey].description) }, range };
            }
        }

        return null;
    };
}
