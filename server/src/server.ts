/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
    CodeActionKind,
    createConnection,
    Diagnostic,
    DocumentDiagnosticReportKind,
    InitializeParams,
    InitializeResult,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    type DocumentDiagnosticReport
} from 'vscode-languageserver/node';

import {
    Range,
    TextDocument
} from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import codeActionProvider from './code-action-provider';
import completionProvider from './completion-provider';
import definitionProvider from './definition-provider';
import hoverProvider from './hover-provider';
import { lintDocument } from './linter';
import { getParserCache } from './parser-cache';
import referenceProvider from './reference-provider';
import renameProvider from './rename-provider';
import type { Common, DamageTypes, MechanicShapes, MechanicTypes, StatusTypes, Terms } from './types/enum-schema';
import documentColorProvider from './document-color-provider';
import colorPresentationProvider from './color-presentation-provider';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasWorkspaceFolderCapability = false;

const TRIGGER_CHARACTERS = '[(: '.split('');

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                triggerCharacters: TRIGGER_CHARACTERS
            },
            diagnosticProvider: {
                interFileDependencies: false,
                workspaceDiagnostics: false
            },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: true,
            codeActionProvider: {
                codeActionKinds: [CodeActionKind.QuickFix]
            },
            colorProvider: true
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }

    return result;
});

connection.onInitialized(() => {
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
});

// The example settings
export interface ThaliakTimelineLinterSettings {
    maxNumberOfProblems: number;
}

interface ParsedYAML<T> {
    yaml: T;
    document: yaml.Document,
    textDocument: TextDocument
}

export interface PropertyOrder {
    range: Range;
    /** Specifies that this item must come between this key and {@link before} (or the start of the object and {@link before} if this is `null`). */
    after: string | undefined;
    /** Specifies that this item must come between {@link after} and this key (or {@link after} and the end of the object if this is `null`). */
    before: string | undefined;
}

export interface LinterOptions extends ThaliakTimelineLinterSettings {
    enums: {
        'common'?: ParsedYAML<Common>,
        'damage-types'?: ParsedYAML<DamageTypes>,
        'expansions'?: ParsedYAML<Record<number, string>>,
        'mechanic-shapes'?: ParsedYAML<MechanicShapes>,
        'mechanic-types'?: ParsedYAML<MechanicTypes>,
        'status-types'?: ParsedYAML<StatusTypes>,
        'terms'?: ParsedYAML<Terms>
    };
    propOrder: Map<string, Map<string, PropertyOrder>>;
}

export const fixableDiagnostics: Diagnostic[] = [];

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ThaliakTimelineLinterSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ThaliakTimelineLinterSettings = defaultSettings;

connection.onDidChangeConfiguration(change => {
    globalSettings = <ThaliakTimelineLinterSettings>(
        (change.settings['thaliak-timeline-linter'] || defaultSettings)
    );
    // Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
    // We could optimize things here and re-fetch the setting first can compare it
    // to the existing setting, but this is out of scope for this example.
    connection.languages.diagnostics.refresh();
});

const documentCache = getParserCache();

documents.onDidOpen(e => {
    documentCache.get(e.document);

    if (documentCache.isSecondaryFile(e.document)) {
        if (documentCache.getOpenDocument() != null) {
            connection.languages.diagnostics.refresh();
        }
    }
});

documents.onDidChangeContent(e => {
    documentCache.get(e.document);

    if (documentCache.isSecondaryFile(e.document)) {
        if (documentCache.getOpenDocument() != null) {
            connection.languages.diagnostics.refresh();
        }
    }
});

// Only keep settings for open documents
documents.onDidClose(e => {
    documentCache.onDocumentRemoved(e.document);
});

connection.onShutdown(() => {
    documentCache.dispose();
});


connection.languages.diagnostics.on(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (document !== undefined && document.getText().trimStart().startsWith('id:')) {
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: await validateTextDocument(document)
        } satisfies DocumentDiagnosticReport;
    } else {
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: []
        } satisfies DocumentDiagnosticReport;
    }
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// documents.onDidChangeContent(change => {
//     validateTextDocument(change.document);
// });


async function validateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {
    const document = documentCache.get(textDocument);

    if (document == null) {
        return [];
    }

    // Parse enums as TextDocuments
    const options = documentCache.getLinterOptions(globalSettings);

    return lintDocument(textDocument, document, options);
}

connection.onDidChangeWatchedFiles(_change => {
    // Monitored files have change in VSCode
    connection.console.log('File change event received.');
});

connection.onCompletion(completionProvider(documents, documentCache, globalSettings));

connection.onHover(hoverProvider(documents, documentCache, globalSettings));
connection.onDefinition(definitionProvider(documents, documentCache, globalSettings));
connection.onReferences(referenceProvider(documents, documentCache, globalSettings));
connection.onRenameRequest(renameProvider(documents, documentCache, globalSettings));
connection.onCodeAction(codeActionProvider(documents, documentCache, globalSettings));
connection.onDocumentColor(documentColorProvider(documents, documentCache, globalSettings));
connection.onColorPresentation(colorPresentationProvider(documents, documentCache, globalSettings));

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
