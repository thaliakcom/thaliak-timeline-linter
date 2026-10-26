import * as fs from 'fs';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import type { OutlineParams, StatusIcon } from './outline-types';

/** The in-game status icons after status keys and in front of `s:` placeholders. */
const decoration = vscode.window.createTextEditorDecorationType({});

/** The data URIs of the PNGs read so far, by path. Icons never change, so they're kept for the session. */
const dataUris = new Map<string, string>();

/** The PNG at `path` as a data URI. */
function pngDataUri(path: string): string {
    let uri = dataUris.get(path);

    if (uri == null) {
        uri = `data:image/png;base64,${fs.readFileSync(path).toString('base64')}`;
        dataUris.set(path, uri);
    }

    return uri;
}

/**
 * Draws the status icons of the timeline in `editor`, or removes them if it isn't a timeline.
 * The icon is a background image, since a `contentIconPath` can't be scaled down to the line height.
 */
export async function updateStatusDecorations(editor: vscode.TextEditor, isTimeline: boolean, client: LanguageClient): Promise<void> {
    let icons: StatusIcon[] | null = null;

    if (isTimeline) {
        try {
            icons = await client.sendRequest<StatusIcon[] | null>('thaliak/statusIcons', { uri: editor.document.uri.toString() } satisfies OutlineParams);
        } catch (e) {
            console.log(`Couldn't get the status icons: ${e}`);
        }
    }

    editor.setDecorations(decoration, (icons ?? []).map(icon => ({
        range: client.protocol2CodeConverter.asRange(icon.range),
        renderOptions: {
            before: {
                contentText: '',
                // Status icons are 3:4 (48×64), as tall as the line
                width: '1em',
                height: '1.35em',
                margin: '0 0.35em 0 0',
                textDecoration: `none; display: inline-block; vertical-align: middle; background: url("${pngDataUri(icon.path)}") center / contain no-repeat`
            }
        }
    })));
}
