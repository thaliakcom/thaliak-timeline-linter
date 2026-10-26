import { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import * as linterRules from './linter-rules';
import { fixableDiagnostics, LinterOptions } from './server';
import { UnprocessedRaidData } from './types/raids';

export interface LinterInput {
    textDocument: TextDocument;
    document: yaml.Document;
    /** `document` as plain JavaScript, converted once per lint since the conversion is expensive. */
    js: UnprocessedRaidData;
    options: LinterOptions;
}

export function lintDocument(textDocument: TextDocument, document: yaml.Document, settings: LinterOptions): Diagnostic[] {
    const input: LinterInput = {
        textDocument,
        document,
        js: document.toJS() as UnprocessedRaidData,
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
