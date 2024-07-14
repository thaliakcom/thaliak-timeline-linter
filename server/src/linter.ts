import { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import * as linterRules from './linter-rules';
import { fixableDiagnostics, LinterOptions } from './server';

export interface LinterInput {
    diagnostics: Diagnostic[];
    textDocument: TextDocument;
    document: yaml.Document;
    options: LinterOptions;
}

export function lintDocument(textDocument: TextDocument, document: yaml.Document, settings: LinterOptions): Diagnostic[] {
    const input: LinterInput = {
        diagnostics: [],
        textDocument,
        document,
        options: settings
    };

    settings.propOrder.clear();
    fixableDiagnostics.length = 0;

    for (const rule of Object.values(linterRules)) {
        rule(input);

        if (input.diagnostics.length >= settings.maxNumberOfProblems) {
            console.log(`Aborting lint as diagnostics exceed ${settings.maxNumberOfProblems}`);
            break;
        }
    }

    return input.diagnostics;
}
