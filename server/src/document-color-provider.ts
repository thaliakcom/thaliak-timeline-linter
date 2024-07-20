import * as color from 'color-string';
import { ColorInformation, DocumentColorParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';

export default function documentColorProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: DocumentColorParams) => ColorInformation[] | null {
    return (params) => {
        const colors: ColorInformation[] = [];
        const textDocument = documents.get(params.textDocument.uri)!;
        
        for (const match of textDocument.getText().matchAll(/((?:#(?:[A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{3}))|rgba?\(.+\))/g)) {
            const parsedColor = color.get(match[1]);

            if (parsedColor != null) {
                colors.push({
                    range: { start: textDocument.positionAt(match.index), end: textDocument.positionAt(match.index + match[0].length) },
                    color: {
                        red: parsedColor.value[0] / 255,
                        green: parsedColor.value[1] / 255,
                        blue: parsedColor.value[2] / 255,
                        alpha: parsedColor.value[3]
                    }
                });
            }
        }

        return colors;
    };
}
