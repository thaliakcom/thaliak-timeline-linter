import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import type { OutlineNode } from './outline-types';

/** The top-level sections that get a line. */
const SECTIONS = ['status', 'actions', 'graphing'];

/** A full-width line above the start of each section, graph and phase. */
const decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: '1px 0 0 0',
    borderStyle: 'solid',
    borderColor: '#59a2e366'
});

/** The lines that start the `status`, `actions` and `graphing` sections, each graph and each phase in `nodes`. */
function sectionLines(nodes: OutlineNode[]): number[] {
    const lines: number[] = [];

    for (const section of nodes) {
        if (SECTIONS.includes(section.label)) {
            lines.push(section.selection.start.line);
        }

        if (section.label === 'timeline') {
            lines.push(...(section.children ?? []).filter(node => node.icon.kind === 'phase').map(node => node.selection.start.line));
        }

        if (section.label === 'graphing') {
            const graphs = section.children?.find(node => node.label === 'graphs');

            lines.push(...(graphs?.children ?? []).map(node => node.selection.start.line));
        }
    }

    return lines;
}

/** Draws the section lines of the outline `nodes` in `editor`, or removes them if it isn't a timeline (`nodes` is `null`). */
export function updateSectionLines(editor: vscode.TextEditor, nodes: OutlineNode[] | null, client: LanguageClient): void {
    const lines = nodes != null ? sectionLines(nodes) : [];

    editor.setDecorations(decoration, lines.map(line => client.protocol2CodeConverter.asRange({ start: { line, character: 0 }, end: { line, character: 0 } })));
}
