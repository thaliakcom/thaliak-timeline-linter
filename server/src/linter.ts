import { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import * as linterRules from './linter-rules';
import { fixableDiagnostics, LinterOptions } from './server';

export interface LinterInput {
    textDocument: TextDocument;
    document: yaml.Document;
    options: LinterOptions;
}

export function lintDocument(textDocument: TextDocument, document: yaml.Document, settings: LinterOptions): Diagnostic[] {
    const input: LinterInput = {
        textDocument,
        document,
        options: settings
    };

    settings.propOrder.clear();
    fixableDiagnostics.length = 0;
    const diagnostics: Diagnostic[] = [];

    for (const rule of Object.values(linterRules)) {
        for (const diagnostic of rule(input)) {
            if (diagnostic.data != null && diagnostic.data.textEdits != null) {
                fixableDiagnostics.push(diagnostic);
            }

            diagnostics.push(diagnostic);
        }

        if (diagnostics.length >= settings.maxNumberOfProblems) {
            console.log(`Aborting lint as diagnostics exceed ${settings.maxNumberOfProblems}`);
            break;
        }
    }

    return diagnostics;
}
