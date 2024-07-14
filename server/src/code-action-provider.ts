import { CodeAction, CodeActionKind, CodeActionParams, Command, Diagnostic, TextDocuments, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserCache } from './parser-cache';
import { fixableDiagnostics, ThaliakTimelineLinterSettings } from './server';

export default function codeActionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: CodeActionParams) => (Command | CodeAction)[] | null {
    return (params) => {
        const codeActions: CodeAction[] = [];
        const textEditsPerCode: Map<string | number, { textEdits: TextEdit[], diagnostics: Diagnostic[] }> = new Map();
        const allTextEdits: TextEdit[] = [];
        const allFixableDiagnostics: Diagnostic[] = [];
        const uniqueKeys: Set<string> = new Set();

        for (const diagnostic of params.context.diagnostics) {
            if (diagnostic.data == null || diagnostic.data.textEdits == null || diagnostic.code == null) {
                continue;
            }

            const textEdits = diagnostic.data.textEdits as TextEdit[];

            if (!textEditsPerCode.has(diagnostic.code)) {
                textEditsPerCode.set(diagnostic.code, { textEdits: [], diagnostics: [] });
            }

            codeActions.push({
                title: `Fix this '${diagnostic.code}' problem`,
                kind: `${CodeActionKind.QuickFix}.${diagnostic.code}`,
                diagnostics: [diagnostic],
                isPreferred: true,
                edit: {
                    changes: {
                        [params.textDocument.uri]: textEdits
                    }
                }
            });
        }

        for (const diagnostic of fixableDiagnostics) {
            if (diagnostic.data == null || diagnostic.data.textEdits == null || diagnostic.code == null) {
                continue;
            }

            if (diagnostic.data.uniqueness != null && uniqueKeys.has(diagnostic.data.uniqueness)) {
                continue;
            }

            const textEdits = diagnostic.data.textEdits as TextEdit[];

            const existingTextEdits = textEditsPerCode.get(diagnostic.code);

            if (existingTextEdits != null) {
                existingTextEdits.textEdits.push(...textEdits);
                existingTextEdits.diagnostics.push(diagnostic);
            }

            allTextEdits.push(...textEdits);
            allFixableDiagnostics.push(diagnostic);

            if (diagnostic.data.uniqueness != null) {
                uniqueKeys.add(diagnostic.data.uniqueness);
            }
        }

        for (const [code, info] of textEditsPerCode.entries()) {
            if (info.diagnostics.length === 1) {
                continue;
            }

            codeActions.push({
                title: `Fix all '${code}' problems`,
                kind: `${CodeActionKind.QuickFix}.${code}.all`,
                diagnostics: info.diagnostics,
                isPreferred: false,
                edit: {
                    changes: {
                        [params.textDocument.uri]: info.textEdits
                    }
                }
            });
        }

        codeActions.push({
            title: `Fix all auto-fixable problems`,
            kind: `${CodeActionKind.QuickFix}.all`,
            diagnostics: allFixableDiagnostics,
            isPreferred: false,
            edit: {
                changes: {
                    [params.textDocument.uri]: allTextEdits
                }
            }
        });

        return codeActions;
    };
}
