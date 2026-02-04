import { CodeAction, CodeActionKind, CodeActionParams, Command, Diagnostic, Range, TextDocuments, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { ParserCache } from './parser-cache';
import { fixableDiagnostics, ThaliakTimelineLinterSettings } from './server';
import { getIfType, getLineAt, getLineLength, getRange, getRangeFromNode, isInRange, isOffsetInRange, isPositionInRange, isPositionInYamlRange } from './util';

const stringifyOptions: yaml.ToStringOptions = {
    collectionStyle: 'block',
    directives: false,
    indent: 4,
    simpleKeys: true
};

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

export function childActionProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, params: CodeActionParams): CodeAction[] {
    const textDocument = documents.get(params.textDocument.uri);
    const document = documentCache.get(params.textDocument);
    
    if (textDocument == null || document == null) {
        return [];
    }

    const text = textDocument.getText(params.range);
    const codeActions: CodeAction[] = [];

    function handleTimeline(seq: yaml.YAMLSeq): boolean {
        if (seq.range == null || !isInRange(textDocument!, params.range, seq.range)) {
            return false;
        }

        let firstItem = -1;
        let lastItem = -1;

        for (let i: number = 0; i < seq.items.length; i++) {
            const item = seq.items[i];
            
            if (!yaml.isMap(item) || item.range == null) {
                continue;
            }
            
            if (firstItem === -1 && (isOffsetInRange(textDocument!, item.range[0], params.range) || isOffsetInRange(textDocument!, item.range[2] - 1, params.range))) {
                firstItem = i;
            }

            if (lastItem === -1 && isPositionInYamlRange(textDocument!, params.range.end, item.range)) {
                lastItem = i;
            }
        }

        if (firstItem === -1 || lastItem === -1 || firstItem >= lastItem || firstItem === 0) {
            return false;
        }
        
        const items = seq.items.slice(firstItem + 1, lastItem + 1);
        const removalStart = getRangeFromNode(seq.items[firstItem + 1])?.[0];
        const removalEnd = getRangeFromNode(seq.items[lastItem])?.[2];
        const newParentItem = seq.items[firstItem];

        if (removalStart == null || removalEnd == null || !yaml.isMap(newParentItem)) {
            return false;
        }

        const parentTimestamp = newParentItem.get('at', true)?.value;
        const parentActionId = newParentItem.get('id', true)?.value as string | undefined;

        if (typeof parentTimestamp !== 'number' || parentActionId == null) {
            return false;
        }

        const actions = getIfType(document!.contents as yaml.YAMLMap, 'actions', yaml.isMap);

        if (actions == null) {
            return false;
        }

        const parentAction = getIfType(actions, parentActionId, yaml.isMap);

        if (parentAction == null) {
            return false;
        }

        const newSeq = new yaml.YAMLSeq();

        for (const item of items) {
            if (yaml.isMap(item)) {
                const newItem = item.clone() as yaml.YAMLMap;
                const at = newItem.get('at', true)?.value;
                
                if (typeof at !== 'number') {
                    newSeq.add(item);
                    continue;
                }

                newItem.set('at', at - parentTimestamp);
                newSeq.add(newItem);
                continue;
            }

            newSeq.add(item);
        }

        // Select the entire line
        const removalStartPosition = textDocument!.positionAt(removalStart);
        removalStartPosition.character = 0;
        const rangeToDelete = getRange(textDocument!, [textDocument!.offsetAt(removalStartPosition), removalEnd, removalEnd]);
        let insertionIndex = -1;
        let insertionText = '';

        const children = getIfType(parentAction, 'children', yaml.isSeq);

        if (children != null && children.range != null) {
            insertionIndex = children.range[2];
            insertionText = '    ' + yaml.stringify(newSeq, stringifyOptions).replaceAll('\n', '\n    ');
            const lastIndex = insertionText.lastIndexOf('\n    ');
            insertionText = insertionText.slice(0, lastIndex + 1);
        } else if (parentAction.range != null) {
            insertionIndex = parentAction.range![2];
            const keyPair = new yaml.Pair('children', newSeq);
            insertionText = '    ' + yaml.stringify(keyPair, stringifyOptions);
        }

        if (insertionIndex === -1) {
            return false;
        }

        codeActions.push({
            title: `Transform to children`,
            kind: `${CodeActionKind.RefactorRewrite}.make-children`,
            edit: {
                changes: {
                    [params.textDocument.uri]: [
                        TextEdit.del(rangeToDelete),
                        TextEdit.insert(textDocument!.positionAt(insertionIndex), insertionText)
                    ]
                }
            }
        });

        return true;
    }

    if (text.length > 0) {
        const actions = getIfType(document, 'actions', yaml.isMap);
        const timeline = getIfType(document, 'timeline', yaml.isSeq);

        if (actions != null && actions.range != null && isInRange(textDocument, params.range, actions.range)) {
            for (const action of actions.items) {
                if (!yaml.isMap(action.value)) {
                    continue;
                }

                const children = getIfType(action.value, 'children', yaml.isSeq);

                if (children != null) {
                    handleTimeline(children);
                }
            }
        }

        if (timeline != null && timeline.range != null && isInRange(textDocument, params.range, timeline.range)) {
            handleTimeline(timeline);
        }
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
                json = yaml.parse(objectString);
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
            ...graphingActionProvider(documents, documentCache, params),
            ...childActionProvider(documents, documentCache, params)
        ];
    };
}
