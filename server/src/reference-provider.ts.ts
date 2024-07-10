import { DefinitionLink, DefinitionParams, Hover, HoverParams, Location, Range, ReferenceParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { UnprocessedRaidData } from './types/raids';

export default function referenceProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: ReferenceParams) => Location[] | null {
    return (params) => {
        return null;
    };
}
