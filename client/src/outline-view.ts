import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import { iconFor } from './outline-icons';
import type { OutlineNode, OutlineParams, TooltipParams } from './outline-types';
import { updateSectionLines } from './section-lines';
import { updateStatusDecorations } from './status-decorations';

/** How long to wait after the last edit before asking the server for a new outline. */
const REFRESH_DELAY = 300;
/** How long to wait after the last cursor move before revealing the row under the cursor. */
const SYNC_DELAY = 100;

function debounce(fn: () => void, delay: number): () => void {
    let timeout: NodeJS.Timeout | undefined;

    return () => {
        clearTimeout(timeout);
        timeout = setTimeout(fn, delay);
    };
}

/** Whether `position` is inside `range`. The end is exclusive, since a node's range ends where the next one starts. */
function contains(range: vscode.Range, position: vscode.Position): boolean {
    return range.start.isBeforeOrEqual(position) && (range.isEmpty ? range.end.isEqual(position) : range.end.isAfter(position));
}

/**
 * The timeline tree view (`thaliak.outline`): the `status`, `actions`, `timeline` and `graphing`
 * sections of the timeline in the active editor, as built by the server's `thaliak/outline`
 * request. Follows the cursor while it's visible.
 */
class OutlineView implements vscode.TreeDataProvider<OutlineNode> {
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeTreeData = this.changeEmitter.event;

    private nodes: OutlineNode[] = [];
    private uri: vscode.Uri | null = null;
    private readonly parents = new Map<OutlineNode, OutlineNode>();
    private readonly ids = new Map<OutlineNode, string>();
    /** Bumped on every request, so that a slow response doesn't overwrite a newer one. */
    private requestId = 0;

    public treeView!: vscode.TreeView<OutlineNode>;

    public constructor(private readonly client: LanguageClient, private readonly extensionUri: vscode.Uri) {}

    public getTreeItem(node: OutlineNode): vscode.TreeItem {
        const hasChildren = (node.children?.length ?? 0) > 0;
        const expanded = node.icon.kind === 'section' || node.icon.kind === 'phase';
        const item = new vscode.TreeItem(node.label, !hasChildren
            ? vscode.TreeItemCollapsibleState.None
            : expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);

        item.id = this.ids.get(node);
        item.description = node.description;
        // Action and status rows get their tooltip in resolveTreeItem, on hover.
        item.tooltip = node.symbol == null ? this.title(node) : undefined;
        item.iconPath = iconFor(node.icon, this.extensionUri);
        item.contextValue = [node.references != null ? 'references' : null, node.definition != null ? 'definition' : null].filter(x => x != null).join(' ');
        item.command = { command: 'thaliak-timeline-linter.outline.reveal', title: 'Reveal', arguments: [node] };

        return item;
    }

    /** Fills in the tooltip of an action or status row: the same as its hover, or the plain tooltip if the server has none. */
    public async resolveTreeItem(item: vscode.TreeItem, node: OutlineNode): Promise<vscode.TreeItem> {
        if (node.symbol != null && this.uri != null) {
            let tooltip: string | null = null;

            try {
                tooltip = await this.client.sendRequest<string | null>('thaliak/tooltip', { uri: this.uri.toString(), symbol: node.symbol } satisfies TooltipParams);
            } catch (e) {
                console.log(`Couldn't get the tooltip of ${node.symbol}: ${e}`);
            }

            if (tooltip != null) {
                const markdown = new vscode.MarkdownString(tooltip);

                markdown.supportHtml = true;
                item.tooltip = markdown;
            } else {
                item.tooltip = this.title(node);
            }
        }

        return item;
    }

    /** The plain tooltip of a row: its label and description. */
    private title(node: OutlineNode): string {
        return node.description != null ? `${node.label} ${node.description}` : node.label;
    }

    public getChildren(node?: OutlineNode): OutlineNode[] {
        return node == null ? this.nodes : node.children ?? [];
    }

    public getParent(node: OutlineNode): OutlineNode | undefined {
        return this.parents.get(node);
    }

    /** Asks the server for the outline of the active editor's document. */
    public async refresh(): Promise<void> {
        const editor = vscode.window.activeTextEditor;

        // No editor, or an editor outside the editor area (like the Output panel): keep showing the last timeline.
        if (editor == null || editor.viewColumn == null) {
            return;
        }

        const requestId = ++this.requestId;
        let nodes: OutlineNode[] | null = null;

        if (editor.document.languageId === 'yaml') {
            try {
                nodes = await this.client.sendRequest<OutlineNode[] | null>('thaliak/outline', { uri: editor.document.uri.toString() } satisfies OutlineParams);
            } catch (e) {
                console.log(`Couldn't get the timeline outline: ${e}`);
            }
        }

        if (requestId !== this.requestId) {
            return;
        }

        this.nodes = nodes ?? [];
        this.uri = nodes != null ? editor.document.uri : null;
        this.parents.clear();
        this.ids.clear();
        this.index(this.nodes, undefined, '');
        this.changeEmitter.fire();
        updateSectionLines(editor, nodes, this.client);
        updateStatusDecorations(editor, nodes != null, this.client);
        this.syncWithCursor();
    }

    /** Fills `parents` and gives every node an ID that stays the same across refreshes, so that expanded rows stay expanded. */
    private index(nodes: OutlineNode[], parent: OutlineNode | undefined, parentId: string): void {
        const seen = new Map<string, number>();

        for (const node of nodes) {
            const key = `${node.label}|${node.description ?? ''}`;
            const occurrence = seen.get(key) ?? 0;
            const id = `${parentId}/${key}#${occurrence}`;

            seen.set(key, occurrence + 1);
            this.ids.set(node, id);

            if (parent != null) {
                this.parents.set(node, parent);
            }

            this.index(node.children ?? [], node, id);
        }
    }

    /** Selects the deepest row whose range contains the cursor, if the view is visible. */
    public syncWithCursor(): void {
        const editor = vscode.window.activeTextEditor;

        if (!this.treeView.visible || editor == null || this.uri == null || editor.document.uri.toString() !== this.uri.toString()) {
            return;
        }

        const cursor = editor.selection.active;
        let match: OutlineNode | undefined;
        let candidates = this.nodes;

        while (true) {
            const next = candidates.find(node => contains(this.client.protocol2CodeConverter.asRange(node.range), cursor));

            if (next == null) {
                break;
            }

            match = next;
            candidates = next.children ?? [];
        }

        if (match != null) {
            this.treeView.reveal(match, { select: true, focus: false, expand: false });
        }
    }

    /** Opens the document at `node`'s selection. */
    public async reveal(node: OutlineNode): Promise<void> {
        if (this.uri != null) {
            await vscode.window.showTextDocument(this.uri, { selection: this.client.protocol2CodeConverter.asRange(node.selection) });
        }
    }

    public async findReferences(node: OutlineNode): Promise<void> {
        if (this.uri != null && node.references != null) {
            await this.reveal(node);
            await vscode.commands.executeCommand('editor.action.findReferences', this.uri, this.client.protocol2CodeConverter.asPosition(node.references));
        }
    }

    public async goToDefinition(node: OutlineNode): Promise<void> {
        if (node.definition != null) {
            const location = this.client.protocol2CodeConverter.asLocation(node.definition);

            await vscode.window.showTextDocument(location.uri, { selection: location.range });
        }
    }
}

/** Registers the timeline tree view, its commands and the events that refresh it. The first refresh waits for `started`, the start of `client`. */
export function registerOutlineView(context: vscode.ExtensionContext, client: LanguageClient, started: Promise<void>): void {
    const view = new OutlineView(client, context.extensionUri);
    const refresh = debounce(() => view.refresh(), REFRESH_DELAY);
    const sync = debounce(() => view.syncWithCursor(), SYNC_DELAY);

    view.treeView = vscode.window.createTreeView('thaliak.outline', { treeDataProvider: view });

    context.subscriptions.push(
        view.treeView,
        vscode.commands.registerCommand('thaliak-timeline-linter.outline.reveal', (node: OutlineNode) => view.reveal(node)),
        vscode.commands.registerCommand('thaliak-timeline-linter.outline.findReferences', (node: OutlineNode) => view.findReferences(node)),
        vscode.commands.registerCommand('thaliak-timeline-linter.outline.goToDefinition', (node: OutlineNode) => view.goToDefinition(node)),
        vscode.window.onDidChangeActiveTextEditor(() => view.refresh()),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === vscode.window.activeTextEditor?.document) {
                refresh();
            }
        }),
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (e.textEditor === vscode.window.activeTextEditor) {
                sync();
            }
        }),
        view.treeView.onDidChangeVisibility(e => {
            if (e.visible) {
                view.syncWithCursor();
            }
        })
    );

    started.then(() => {
        // The server only knows a document once VS Code has sent it over, which can be after the first
        // request (e.g. for the editor that's already open on startup), so refresh when it arrives.
        context.subscriptions.push(client.onNotification('thaliak/documentOpened', ({ uri }: { uri: string }) => {
            if (vscode.window.activeTextEditor?.document.uri.toString() === uri) {
                view.refresh();
            }
        }));

        view.refresh();
    });
}
