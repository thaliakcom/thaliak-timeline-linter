import * as color from 'color-string';
import { ColorPresentation, ColorPresentationParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';

export default function colorPresentationProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: ColorPresentationParams) => ColorPresentation[] | null {
    return (params) => {
        const values = [params.color.red * 255, params.color.green * 255, params.color.blue * 255, params.color.alpha];

        return [
            { label: color.to.hex(values) },
            { label: color.to.rgb(values) }
        ];
    };
}
