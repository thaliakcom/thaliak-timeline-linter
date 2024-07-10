/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(
        path.join('out', 'server', 'src', 'server.js')
    );

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
        }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: [{ language: 'yaml' }]
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'thaliak-timeline-linter',
        'Thaliak Timeline Linter',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start();

    vscode.workspace.findFiles('**/enums/*.yaml', '**/node_modules')
        .then(uris => {
            for (const uri of uris) {
                vscode.workspace.openTextDocument(uri);
            }
        });

    vscode.commands.registerCommand('thaliak-timeline-linter.restart', () => client.restart());
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
