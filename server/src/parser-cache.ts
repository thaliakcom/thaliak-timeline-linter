import { TextDocumentIdentifier } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { LinterOptions, ThaliakTimelineLinterSettings } from './server';

// Based on https://github.com/microsoft/vscode/blob/main/extensions/json-language-features/server/src/languageModelCache.ts

export interface ParserCache {
    get(document: TextDocument | TextDocumentIdentifier): yaml.Document | null;
    getOpenDocument(): TextDocument | null;
    isSecondaryFile(document: TextDocument | TextDocumentIdentifier): boolean;
    onDocumentRemoved(document: TextDocument): void;
    getLinterOptions(settings: ThaliakTimelineLinterSettings): LinterOptions;
    dispose(): void;
}

interface Document {
    version?: number;
    languageId?: string;
    cTime: number;
    ast: yaml.Document,
    textDocument: TextDocument,
    isRelevant: boolean;
}

export function getParserCache(): ParserCache {
    let secondaryDocuments: { [uri: string]: Document } = {};
    let openDocument: Document | null = null;
    const options: LinterOptions = { maxNumberOfProblems: Infinity, enums: {}, propOrder: new Map() };

    return {
        get(document: TextDocument | TextDocumentIdentifier): yaml.Document | null {
            const isEnum = document.uri.includes('enums/');

            const info = isEnum ? secondaryDocuments[document.uri] : (openDocument?.textDocument.uri === document.uri ? openDocument : null);

            const version = 'version' in document ? document.version : info?.version;
            const languageId = 'languageId' in document ? document.languageId : info?.languageId;
            if (info != null && info.version === version && info.languageId === languageId) {
                info.cTime = Date.now();

                if (!info.isRelevant) {
                    return null;
                }

                return info.ast;
            }

            if (!('getText' in document)) {
                return null;
            }

            console.log('Adding or updating', document.uri);

            try {
                const yamlDocument = yaml.parseDocument(document.getText());
                const newInfo: Document = { ast: yamlDocument, textDocument: document, version, languageId, cTime: Date.now(), isRelevant: isEnum || isRaidData(yamlDocument.toJS()) };
    
                if (isEnum) {
                    secondaryDocuments[document.uri] = newInfo;
                    const name = document.uri.slice(document.uri.lastIndexOf('/') + 1, document.uri.lastIndexOf('.yaml'));
                    (options.enums as any)[name] = { yaml: yamlDocument.toJS(), document: yamlDocument, textDocument: document };
                } else {
                    openDocument = newInfo;
                }
    
                return yamlDocument;
            } catch (e) {
                console.log(`Aborting ParserCache.get() due to error in the source document.`);
                return null;
            }
        },
        isSecondaryFile(document: TextDocument | TextDocumentIdentifier): boolean {
            this.get(document);
            return secondaryDocuments[document.uri] != null;
        },
        getOpenDocument() {
            return openDocument?.textDocument ?? null;
        },
        onDocumentRemoved(document: TextDocument) {
            console.log('Removing', document.uri, '(onDocumentRemoved)');

            // We don't remove any secondaryDocuments here
            // because VSCode occasionally closes documents on its own
            // and we still need the enum information.
            if (secondaryDocuments[document.uri] == null && openDocument != null && openDocument.textDocument.uri === document.uri) {
                openDocument = null;
            }
        },
        getLinterOptions(settings: ThaliakTimelineLinterSettings): LinterOptions {
            Object.assign(options, settings);

            return options;
        },
        dispose() {
            secondaryDocuments = {};
            openDocument = null;
        }
    };
}

function isRaidData(json: Record<string, unknown>): boolean {
    return typeof json.id === 'number'
        && typeof json.patch === 'string'
        && json.by != null
        && typeof json.boss === 'string'
        && typeof json.description === 'string';
}
