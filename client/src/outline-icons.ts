import * as fs from 'fs';
import * as vscode from 'vscode';
import type { OutlineIcon } from './outline-types';

/** The icon file in `media/shapes` of each mechanic shape (`enums/mechanic-shapes.yaml`). Keep in sync with `server/src/tooltip.ts`. */
const SHAPE_FILES: Record<string, string> = {
    'chariot': 'circle',
    'defamation': 'circle',
    'dynamo': 'donut',
    'in-or-out': 'in-or-out',
    'cone': 'cone',
    '270°': '270',
    'line': 'line',
    'grid': 'grid',
    'plus': 'plus',
    'cross': 'cross',
    'sides': 'sides',
    'rect': 'rectangle',
    'halfroom': 'halfroom',
    'star': 'star'
};

/** The icon file in `media/shapes` of each graphing element type drawn as an AoE. */
const ELEMENT_SHAPE_FILES: Record<string, string> = {
    'donut': 'donut',
    'ellipse': 'circle',
    'cone': 'cone',
    'rectangle': 'rectangle'
};

/** The codicons of the section headers, by section key. */
const SECTION_CODICONS: Record<string, string> = {
    'status': 'pulse',
    'actions': 'flame',
    'timeline': 'history',
    'graphing': 'graph',
    'elements': 'symbol-misc',
    'graphs': 'graph'
};

/** The keys of the untyped elements that are drawn as the boss (`media/boss.svg`, from `thaliak/www/images/boss.svg`). */
const BOSS_KEYS = ['boss', 'enemy'];

/** The codicons of the other graphing element types. Elements without a type get `person`. */
const ELEMENT_CODICONS: Record<string, string> = {
    'image': 'file-media',
    'link': 'link',
    'prism': 'symbol-constant'
};

/** Whether the marker look `look` has an icon in `media/markers`. Memoised, since markers added later have none. */
const markerIcons = new Map<string, boolean>();

function markerIcon(look: string | undefined, extensionUri: vscode.Uri): vscode.ThemeIcon | vscode.Uri {
    if (look != null) {
        const uri = vscode.Uri.joinPath(extensionUri, 'media', 'markers', `${look}.svg`);

        if (!markerIcons.has(look)) {
            markerIcons.set(look, fs.existsSync(uri.fsPath));
        }

        if (markerIcons.get(look)) {
            return uri;
        }
    }

    return new vscode.ThemeIcon('pin');
}

/** The icon of a tree view row depicting `icon`. */
export function iconFor(icon: OutlineIcon, extensionUri: vscode.Uri): vscode.ThemeIcon | vscode.Uri {
    const media = (...segments: string[]) => vscode.Uri.joinPath(extensionUri, 'media', ...segments);

    switch (icon.kind) {
        case 'status':
            if (icon.path != null) {
                return vscode.Uri.file(icon.path);
            }

            return icon.dot ? media('status', 'dot.svg') : new vscode.ThemeIcon('symbol-event');
        case 'shape': {
            const file = icon.shape != null ? SHAPE_FILES[icon.shape] : undefined;

            return file != null ? media('shapes', `${file}.svg`) : new vscode.ThemeIcon('symbol-method');
        }
        case 'element': {
            if (icon.type === 'marker') {
                return markerIcon(icon.look, extensionUri);
            }

            if (icon.type == null && BOSS_KEYS.includes(icon.key)) {
                return media('boss.svg');
            }

            const file = icon.type != null ? ELEMENT_SHAPE_FILES[icon.type] : undefined;

            if (file != null) {
                return media('shapes', `${file}.svg`);
            }

            return new vscode.ThemeIcon(icon.type != null ? ELEMENT_CODICONS[icon.type] ?? 'symbol-misc' : 'person');
        }
        case 'graph': return new vscode.ThemeIcon('graph');
        case 'phase': return new vscode.ThemeIcon('milestone');
        case 'step': return new vscode.ThemeIcon('list-ordered');
        case 'section': return new vscode.ThemeIcon(SECTION_CODICONS[icon.name] ?? 'symbol-namespace');
    }
}
