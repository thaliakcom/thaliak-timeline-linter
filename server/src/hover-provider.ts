import { Hover, HoverParams, Range, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';

function makeDescription(name: string, description: string): string {
    return `## ${name}\n\n${description}`;
}

export default function hoverProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: HoverParams) => Hover | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const lineBefore = textDocument.getText({ start: { line: params.position.line, character: 0 }, end: params.position });
        const lineAfter = textDocument.getText({ start: params.position, end: { line: params.position.line, character: Infinity } });

        let startIndex = lineBefore.lastIndexOf('[');
        let brackets = true;

        if (startIndex === -1) {
            startIndex = lineBefore.lastIndexOf('(');
            brackets = false;
        }

        const endSymbol = brackets ? ']' : ')';
        const endIndex = lineAfter.indexOf(endSymbol);

        if (startIndex === -1 || endIndex === -1) {
            return null;
        }

        const keyBefore = lineBefore.slice(startIndex + 1);
        const keyAfter = lineAfter.slice(0, endIndex);
        const key = keyBefore + keyAfter;

        if (key.includes(brackets ? '[' : '(') || key.includes(endSymbol)) {
            return null;
        }

        const range: Range = {
            start: { line: params.position.line, character: params.position.character - keyBefore.length },
            end: { line: params.position.line, character: params.position.character + keyAfter.length } };
    
        const raidData = (documentCache.get(textDocument)?.toJS() as UnprocessedRaidData | undefined);
        const actions = raidData?.actions;
        const status = raidData?.status;
        const enums = documentCache.getLinterOptions(settings).enums;

        if (key.startsWith('a:')) {
            const innerKey = key.slice(2);
            const action = actions?.[innerKey];

            if (action != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, action.description) }, range };
            } else if (enums != null && enums.common.actions[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, 'Common action (`enums/common.yaml`).') }, range };
            }
        } else if (key.startsWith('s:')) {
            const innerKey = key.slice(2);
            const item = status?.[innerKey];

            if (item != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, item.description ?? 'Status effect.') }, range };
            } else if (enums != null && enums.common.status[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, 'Common status (`enums/common.yaml`).') }, range };
            }
        } else if (key.startsWith('t:')) {
            const innerKey = key.slice(2);

            if (enums != null && enums.terms[innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(innerKey, enums.terms[innerKey]) }, range };
            }
        } else if (key.startsWith('m:')) {
            const innerKey = key.slice(2);

            if (enums != null && enums['mechanic-types'][innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(enums['mechanic-types'][innerKey].name, enums['mechanic-types'][innerKey].description) }, range };
            }
        } else if (key.startsWith('ms:')) {
            const innerKey = key.slice(2);

            if (enums != null && enums['mechanic-shapes'][innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(enums['mechanic-shapes'][innerKey].name, enums['mechanic-shapes'][innerKey].description) }, range };
            }
        } else if (key.startsWith('st:')) {
            const innerKey = key.slice(2);

            if (enums != null && enums['status-types'][innerKey] != null) {
                return { contents: { kind: 'markdown', value: makeDescription(enums['status-types'][innerKey].name, enums['status-types'][innerKey].description) }, range };
            }
        }

        return null;
    };
}
