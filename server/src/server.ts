/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    DocumentDiagnosticReportKind,
    type DocumentDiagnosticReport
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import { getParserCache } from './parser-cache';
import { lintDocument } from './linter';
import type { Common, DamageTypes, MechanicShapes, MechanicTypes, StatusTypes, Terms } from './types/enum-schema';
import { UnprocessedRaidData } from './types/raids';
import completionProvider from './completion-provider';
import hoverProvider from './hover-provider';
import definitionProvider from './definition-provider';
import referenceProvider from './reference-provider';
import * as yaml from 'yaml';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasWorkspaceFolderCapability = false;

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
                resolveProvider: true,
                triggerCharacters: ['[', '(']
            },
            diagnosticProvider: {
                interFileDependencies: false,
                workspaceDiagnostics: false
            },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true
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
}

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
});

documents.onDidChangeContent(e => {
    documentCache.get(e.document);
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

connection.onCompletionResolve(item => item);

connection.onHover(hoverProvider(documents, documentCache, globalSettings));
connection.onDefinition(definitionProvider(documents, documentCache, globalSettings));
connection.onReferences(referenceProvider(documents, documentCache, globalSettings));

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
