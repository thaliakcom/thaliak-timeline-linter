import { TextDocumentIdentifier } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { isDiagramUri } from './diagram-context';
import { LinterOptions, ThaliakTimelineLinterSettings } from './server';

/** The end of the URI of the data repository's schema of `.diagram` files. */
const DIAGRAM_SCHEMA = 'schemas/diagram.schema.json';

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
            // A `.diagram` file isn't YAML, and opening one must not replace the timeline being edited.
            if (isDiagramUri(document.uri)) {
                return null;
            }

            const isEnum = document.uri.includes('enums/');
            const isSchema = document.uri.endsWith(DIAGRAM_SCHEMA);

            const info = isEnum || isSchema ? secondaryDocuments[document.uri] : (openDocument?.textDocument.uri === document.uri ? openDocument : null);

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

            // The schema isn't linted, so it has no AST.
            if (isSchema) {
                try {
                    options.diagramSchema = JSON.parse(document.getText());
                } catch (e) {
                    console.log(`Couldn't read the diagram schema from ${document.uri}: ${e}`);
                }

                secondaryDocuments[document.uri] = { ast: new yaml.Document(), textDocument: document, version, languageId, cTime: Date.now(), isRelevant: false };
                return null;
            }

            try {
                const yamlDocument = yaml.parseDocument(document.getText());
                const newInfo: Document = { ast: yamlDocument, textDocument: document, version, languageId, cTime: Date.now(), isRelevant: isEnum || isRaidData(yamlDocument) };
    
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

/** Whether `document` is a timeline. Reads the AST, since converting the whole document is expensive. */
function isRaidData(document: yaml.Document): boolean {
    return typeof document.get('id') === 'number'
        && typeof document.get('patch') === 'string'
        && document.get('by') != null
        && typeof document.get('boss') === 'string'
        && typeof document.get('description') === 'string';
}
