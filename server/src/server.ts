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
import hoverProvider, { tooltipProvider } from './hover-provider';
import { lintDocument } from './linter';
import { getParserCache } from './parser-cache';
import referenceProvider from './reference-provider';
import { renameProvider, prepareRenameProvider } from './rename-provider';
import type { Common, DamageTypes, MechanicShapes, MechanicTypes, StatusTypes, Terms } from './types/enum-schema';
import type { DiagramSchema } from './types/diagram-schema';
import type { OutlineNode, OutlineParams } from './types/outline';
import documentColorProvider from './document-color-provider';
import colorPresentationProvider from './color-presentation-provider';
import inlayHintProvider from './inlay-hint-provider';
import outlineProvider from './outline-provider';
import statusIconProvider, { iconSpacers } from './status-icon-provider';
import { configureIronworks, type IronworksOptions } from './ironworks';
import { diagramOf, isDiagramUri, statusKeysOf } from './diagram-context';
import { lintDiagram } from './diagram-linter';
import { lintGameData } from './game-data-rules';
import { diagramCompletionProvider, diagramDefinitionProvider, diagramHoverProvider, diagramInlayHintProvider, diagramOutlineProvider, diagramReferenceProvider, diagramStatusIconProvider } from './diagram-providers';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasWorkspaceFolderCapability = false;

const TRIGGER_CHARACTERS = '[(: '.split('');

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    configureIronworks((params.initializationOptions as { ironworks?: IronworksOptions } | undefined)?.ironworks, message => connection.window.showWarningMessage(message));

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
            renameProvider: { prepareProvider: true },
            codeActionProvider: {
                codeActionKinds: [CodeActionKind.QuickFix]
            },
            colorProvider: true,
            inlayHintProvider: true
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

/**
 * The order that the keys (or diagram elements, for graph steps) of the maps of one kind must
 * follow. Only holds relations seen in the maps themselves, so it's a partial order.
 */
export interface PropertyOrder {
    /** For every known key, all keys that must come after it, directly or transitively. */
    successors: Map<string, Set<string>>;
    /** For every key, the keys seen after it in one map, with the range of the key in the first such map. */
    relations: Map<string, Map<string, Range>>;
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
    /** From `schemas/diagram.schema.json`, once the client has opened it. */
    diagramSchema?: DiagramSchema;
    propOrder: Map<string, PropertyOrder>;
}

/** The diagnostics with an automatic fix, by document, from each document's last lint. */
export const fixableDiagnostics = new Map<string, Diagnostic[]>();

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
    } else {
        // Lets the client's timeline tree view retry an outline request that came before the document.
        connection.sendNotification('thaliak/documentOpened', { uri: e.document.uri });
    }
});

documents.onDidChangeContent(e => {
    documentCache.get(e.document);

    if (documentCache.isSecondaryFile(e.document)) {
        if (documentCache.getOpenDocument() != null) {
            connection.languages.diagnostics.refresh();
        }
    } else if (e.document.uri.endsWith('.yaml') && documents.get(e.document.uri.replace(/\.yaml$/, '.diagram')) != null) {
        // A `.diagram` file's diagnostics depend on its timeline.
        connection.languages.diagnostics.refresh();
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
    if (document !== undefined && isDiagramUri(document.uri)) {
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: await lintDiagram(document, documents, documentCache.getLinterOptions(globalSettings))
        } satisfies DocumentDiagnosticReport;
    } else if (document !== undefined && document.getText().trimStart().startsWith('id:')) {
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

    const diagram = diagramOf(documents, textDocument.uri);
    const diagramStatuses = diagram != null ? statusKeysOf(diagram) : new Set<string>();

    return [...lintDocument(textDocument, document, options, diagramStatuses), ...await lintGameData(textDocument, document, options)];
}

connection.onDidChangeWatchedFiles(_change => {
    // Monitored files have change in VSCode
    connection.console.log('File change event received.');
});

/** Sends requests about `.diagram` files to `diagram`, and all others to `timeline`. */
function byFileType<P, R>(uriOf: (params: P) => string, diagram: (params: P) => R, timeline: (params: P) => R): (params: P) => R {
    return params => isDiagramUri(uriOf(params)) ? diagram(params) : timeline(params);
}

const textDocumentUri = (params: { textDocument: { uri: string } }) => params.textDocument.uri;
const outlineUri = (params: { uri: string }) => params.uri;

connection.onCompletion(byFileType(textDocumentUri, diagramCompletionProvider(documents, documentCache, globalSettings), completionProvider(documents, documentCache, globalSettings)));

connection.onHover(byFileType(textDocumentUri, diagramHoverProvider(documents, documentCache, globalSettings), hoverProvider(documents, documentCache, globalSettings)));
connection.onDefinition(byFileType(textDocumentUri, diagramDefinitionProvider(documents), definitionProvider(documents, documentCache, globalSettings)));
connection.onReferences(byFileType(textDocumentUri, diagramReferenceProvider(documents), referenceProvider(documents, documentCache, globalSettings)));
connection.onRenameRequest(renameProvider(documents, documentCache, globalSettings));
connection.onPrepareRename(prepareRenameProvider(documents, documentCache, globalSettings));
connection.onCodeAction(codeActionProvider(documents, documentCache, globalSettings));
connection.onDocumentColor(documentColorProvider(documents, documentCache, globalSettings));
connection.onColorPresentation(colorPresentationProvider(documents, documentCache, globalSettings));
const inlayHints = byFileType(textDocumentUri, diagramInlayHintProvider(documents), inlayHintProvider(documents, documentCache, globalSettings));
const statusIcons = byFileType(outlineUri, diagramStatusIconProvider(documents, documentCache, globalSettings), statusIconProvider(documents, documentCache, globalSettings));

connection.languages.inlayHint.on(async params => [...inlayHints(params), ...iconSpacers(await statusIcons({ uri: params.textDocument.uri }), params.range)]);
connection.onRequest('thaliak/outline', byFileType<OutlineParams, Promise<OutlineNode[] | null>>(outlineUri, async params => diagramOutlineProvider(documents)(params), outlineProvider(documents, documentCache, globalSettings)));
connection.onRequest('thaliak/statusIcons', statusIcons);
connection.onRequest('thaliak/tooltip', tooltipProvider(documents, documentCache, globalSettings));

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
