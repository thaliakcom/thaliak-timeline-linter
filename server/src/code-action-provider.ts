import { CodeAction, CodeActionKind, CodeActionParams, Command, Diagnostic, TextDocuments, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { fixableDiagnostics, ThaliakTimelineLinterSettings } from './server';
import { getIfType, getLineAt, isInRange } from './util';

function autoFixerProvider(params: CodeActionParams): CodeAction[] {
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

    if (codeActions.length > 0) {
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
    }

    return codeActions;
}

function graphingActionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, params: CodeActionParams): CodeAction[] {
    const textDocument = documents.get(params.textDocument.uri);
    const document = documentCache.get(params.textDocument);
    
    if (textDocument == null || document == null) {
        return [];
    }

    const graphing = getIfType(document, 'graphing', yaml.isMap);

    if (graphing == null || !isInRange(textDocument, params.range, graphing.range!)) {
        return [];
    }
    
    const codeActions: CodeAction[] = [];
    const { lineBefore, lineAfter } = getLineAt(textDocument, params.range.start);
    const squareBracketIndex = lineBefore.lastIndexOf('[');
    const squareBracketIndexEnd = lineAfter.lastIndexOf(']');

    if (squareBracketIndex > -1 && squareBracketIndexEnd > -1) {
        const arrayString = lineBefore.slice(squareBracketIndex).concat(lineAfter.slice(0, squareBracketIndexEnd + 1));
        let json: unknown[];

        try {
            json = JSON.parse(arrayString);
        } catch {
            json = [];
        }

        if ((json.length === 2 || json.length === 3) && json.every(x => typeof x === 'number')) {
            codeActions.push({
                title: `Convert to object notation`,
                kind: `${CodeActionKind.RefactorInline}.convert-notation.array`,
                edit: {
                    changes: {
                        [params.textDocument.uri]: [{
                            range: { start: { line: params.range.start.line, character: squareBracketIndex }, end: { line: params.range.start.line, character: lineBefore.length + squareBracketIndexEnd + 1 } },
                            newText: json.length === 3 ? `{ x: ${json[0]}, y: ${json[1]}, rotate: ${json[2]} }` : `{ x: ${json[0]}, y: ${json[1]} }`
                        }]
                    }
                }
            });
        }
    } else {
        const curlyBracketIndex = lineBefore.lastIndexOf('{');
        const curlyBracketIndexEnd = lineAfter.lastIndexOf('}');

        if (curlyBracketIndex > -1 && curlyBracketIndexEnd > -1) {
            const objectString = lineBefore.slice(curlyBracketIndex).concat(lineAfter.slice(0, curlyBracketIndexEnd + 1));
            let json: Record<string, unknown>;
    
            try {
                json = JSON.parse(objectString);
            } catch {
                json = {};
            }
    
            if (typeof json.x === 'number' && typeof json.y === 'number') {
                codeActions.push({
                    title: `Convert to array notation`,
                    kind: `${CodeActionKind.RefactorInline}.convert-notation.object`,
                    edit: {
                        changes: {
                            [params.textDocument.uri]: [{
                                range: { start: { line: params.range.start.line, character: curlyBracketIndex }, end: { line: params.range.start.line, character: lineBefore.length + curlyBracketIndexEnd + 1 } },
                                newText: typeof json.rotate === 'number' ? `[${json.x}, ${json.y}, ${json.rotate}]` : `[${json.x}, ${json.y}]`
                            }]
                        }
                    }
                });
            }
        }
    }

    return codeActions;
}

export default function codeActionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: CodeActionParams) => (Command | CodeAction)[] | null {
    return (params) => {
        return [
            ...autoFixerProvider(params),
            ...graphingActionProvider(documents, documentCache, params)
        ];
    };
}
