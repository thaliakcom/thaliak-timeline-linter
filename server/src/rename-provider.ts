import { TextDocumentPositionParams, TextDocuments, WorkspaceEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';

export default function renameProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: TextDocumentPositionParams) => WorkspaceEdit | null {
    return (params) => {
        // TODO

        return null;
    };
}
