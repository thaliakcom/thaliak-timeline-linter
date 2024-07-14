import { DefinitionLink, DefinitionParams, Range, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { ThaliakTimelineLinterSettings } from './server';
import { getAction, getEntry, getRange, getStatus, getSymbolAt, perPrefix } from './util';

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
        const document = documentCache.get(textDocument);

        if (document == null) {
            return null;
        }

        const result = getSymbolAt(document, textDocument, params.position);

        if (result == null) {
            return null;
        }

        const { text: key, range } = result;

        const enums = documentCache.getLinterOptions(settings).enums;

        return perPrefix(key, {
            'a:': key => {
                let action = getAction(document, key);
                let refDocument = textDocument;
    
                if (action == null && enums.common != null) {
                    action = getAction(enums.common.document, key);
                    refDocument = enums.common.textDocument;
                }
    
                if (action != null) {
                    return makeDefinitionLink(range, refDocument, action);
                }
            },
            's:': key => {
                let status = getStatus(document, key);
                let refDocument = textDocument;
    
                if (status == null && enums.common != null) {
                    status = getStatus(enums.common.document, key);
                    refDocument = enums.common.textDocument;
                }
    
                if (status != null) {
                    return makeDefinitionLink(range, refDocument, status);
                }
            },
            't:': key => {
                if (enums.terms != null && yaml.isMap(enums.terms.document.contents)) {
                    const term = getEntry(enums.terms.document.contents, key);
    
                    if (term != null) {
                        return makeDefinitionLink(range, enums.terms.textDocument, term);
                    }
                }
            },
            'm:': key => {
                if (enums['mechanic-types'] != null && yaml.isMap(enums['mechanic-types'].document.contents)) {
                    const mechanicType = getEntry(enums['mechanic-types'].document.contents, key);
    
                    if (mechanicType != null) {
                        return makeDefinitionLink(range, enums['mechanic-types'].textDocument, mechanicType);
                    }
                }
            },
            'ms:': key => {
                if (enums['mechanic-shapes'] != null && yaml.isMap(enums['mechanic-shapes'].document.contents)) {
                    const mechanicShape = getEntry(enums['mechanic-shapes'].document.contents, key);

                    if (mechanicShape != null) {
                        return makeDefinitionLink(range, enums['mechanic-shapes'].textDocument, mechanicShape);
                    }
                }
            },
            'st:': key => {
                if (enums['status-types'] != null && yaml.isMap(enums['status-types'].document.contents)) {
                    const statusType = getEntry(enums['status-types'].document.contents, key);

                    if (statusType != null) {
                        return makeDefinitionLink(range, enums['status-types'].textDocument, statusType);
                    }
                }
            },
            'dt:': key => {
                if (enums['damage-types'] != null && yaml.isMap(enums['damage-types'].document.contents)) {
                    const damageType = getEntry(enums['damage-types'].document.contents, key);

                    if (damageType != null) {
                        return makeDefinitionLink(range, enums['damage-types'].textDocument, damageType);
                    }
                }
            }
        }) ?? null;
    };
}
