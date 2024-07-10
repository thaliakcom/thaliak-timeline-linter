import { DefinitionLink, DefinitionParams, Range, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { getAction, getEntry, getPlaceholderAt, getRange, getStatus } from './util';

function makeDefinitionLink(originRange: Range, textDocument: TextDocument, target: yaml.Pair<yaml.Node<unknown>, yaml.Node<unknown>>): [DefinitionLink] {
    return [{
        originSelectionRange: originRange,
        targetUri: textDocument.uri,
        targetRange: getRange(textDocument, [target.key.range![0], ...target.value!.range!.slice(1)] as yaml.Range),
        targetSelectionRange: getRange(textDocument, target.key.range!)
    }];
}

export default function definitionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: DefinitionParams) => DefinitionLink[] | null {
    return (params) => {
        const textDocument = documents.get(params.textDocument.uri)!;
        const result = getPlaceholderAt(textDocument, params.position);

        if (result == null) {
            return null;
        }

        const { text: key, range } = result;
    
        const document = documentCache.get(textDocument);

        if (document == null) {
            return null;
        }

        const enums = documentCache.getLinterOptions(settings).enums;

        if (key.startsWith('a:')) {
            const innerKey = key.slice(2);
            let action = getAction(document, innerKey);
            let refDocument = textDocument;

            if (action == null && enums.common != null) {
                action = getAction(enums.common.document, innerKey);
                refDocument = enums.common.textDocument;
            }

            if (action != null) {
                return makeDefinitionLink(range, refDocument, action);
            }
        } else if (key.startsWith('s:')) {
            const innerKey = key.slice(2);
            let status = getStatus(document, innerKey);
            let refDocument = textDocument;

            if (status == null && enums.common != null) {
                status = getStatus(enums.common.document, innerKey);
                refDocument = enums.common.textDocument;
            }

            if (status != null) {
                return makeDefinitionLink(range, refDocument, status);
            }
        } else if (key.startsWith('t:')) {
            const innerKey = key.slice(2);

            if (enums.terms != null && yaml.isMap(enums.terms.document.contents)) {
                const term = getEntry(enums.terms.document.contents, innerKey);

                if (term != null) {
                    return makeDefinitionLink(range, enums.terms.textDocument, term);
                }
            }
        } else if (key.startsWith('m:')) {
            const innerKey = key.slice(2);

            if (enums['mechanic-types'] != null && yaml.isMap(enums['mechanic-types'].document.contents)) {
                const mechanicType = getEntry(enums['mechanic-types'].document.contents, innerKey);

                if (mechanicType != null) {
                    return makeDefinitionLink(range, enums['mechanic-types'].textDocument, mechanicType);
                }
            }
        } else if (key.startsWith('ms:')) {
            const innerKey = key.slice(2);

            if (enums['mechanic-shapes'] != null && yaml.isMap(enums['mechanic-shapes'].document.contents)) {
                const mechanicShape = getEntry(enums['mechanic-shapes'].document.contents, innerKey);

                if (mechanicShape != null) {
                    return makeDefinitionLink(range, enums['mechanic-shapes'].textDocument, mechanicShape);
                }
            }
        } else if (key.startsWith('st:')) {
            const innerKey = key.slice(2);

            if (enums['status-types'] != null && yaml.isMap(enums['status-types'].document.contents)) {
                const statusType = getEntry(enums['status-types'].document.contents, innerKey);

                if (statusType != null) {
                    return makeDefinitionLink(range, enums['status-types'].textDocument, statusType);
                }
            }
        }

        return null;
    };
}
