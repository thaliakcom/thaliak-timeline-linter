import * as paths from 'path';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { baseOf, timelineOf, tokensOf } from './diagram-context';
import { ParserCache } from './parser-cache';
import { LinterOptions, ThaliakTimelineLinterSettings } from './server';
import { actionEffectRange, MEDIA, SHAPE_FILES } from './tooltip';
import { OutlineParams, StatusIcon } from './types/outline';
import { UnprocessedAction, UnprocessedRaidData } from './types/raids';
import { generatedShapeIcon } from './utility/shape-icons';
import { PLACEHOLDER_REGEX } from './util';

/**
 * The icon of the mechanic shape `shape` as the site shows it, or `null` if the shape has none: for a cone with an
 * `angle` or a donut with an `inner` radius, one generated for `action`'s size (a donut only with game data, which
 * gives its outer radius), else the static one from `media/shapes`. `raid` gives the timeline for the outer radius.
 */
async function shapeIcon(enums: LinterOptions['enums'], shape: string, action: Partial<UnprocessedAction> | null, raid: () => UnprocessedRaidData | null): Promise<Pick<StatusIcon, 'path' | 'svg'> | null> {
    if (enums['mechanic-shapes']?.yaml[shape]?.icon == null) {
        return null;
    }

    const effectRange = shape === 'dynamo' && action?.inner != null ? await actionEffectRange(raid(), action, action.id) : undefined;
    const svg = generatedShapeIcon({ shape, angle: action?.angle, inner: action?.inner, effectRange });

    if (svg != null) {
        return { svg };
    }

    const file = SHAPE_FILES[shape];

    return file != null ? { path: paths.join(MEDIA, 'shapes', `${file}.svg`) } : null;
}

/**
 * The shape icons of a timeline file: one in front of the value of each `shape` (for the action or auto-attack it's
 * in), and one in front of each `ms:` placeholder. `null` if the file isn't a timeline.
 */
export function shapeIconProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: OutlineParams) => Promise<StatusIcon[] | null> {
    return async (params) => {
        const textDocument = documents.get(params.uri);
        const document = textDocument != null ? documentCache.get(textDocument) : null;

        if (textDocument == null || document == null || !yaml.isMap(document.contents)) {
            return null;
        }

        const enums = documentCache.getLinterOptions(settings).enums;
        // Converting the whole timeline is slow, and only donuts with an `inner` radius need it.
        let raid: UnprocessedRaidData | undefined;
        const raidOf = () => raid ??= document.toJS() as UnprocessedRaidData;
        const icons: Promise<StatusIcon | null>[] = [];

        /** Adds the icon of `shape` at `offset`, sized for `action` if given. */
        function add(offset: number, shape: string, action: Partial<UnprocessedAction> | null): void {
            const position = textDocument!.positionAt(offset);

            icons.push(shapeIcon(enums, shape, action, raidOf).then(icon => icon != null ? { range: { start: position, end: position }, ...icon } : null));
        }

        yaml.visit(document, {
            Pair(_, pair, path) {
                if (yaml.isScalar(pair.key) && pair.key.value === 'shape' && yaml.isScalar(pair.value) && typeof pair.value.value === 'string' && pair.value.range != null) {
                    const owner = path.at(-1);

                    add(pair.value.range[0], pair.value.value, yaml.isMap(owner) ? owner.toJSON() as Partial<UnprocessedAction> : null);
                }
            }
        });

        for (const match of textDocument.getText().matchAll(PLACEHOLDER_REGEX)) {
            const reference = match[1] ?? match[2];

            if (reference.startsWith('ms:')) {
                add(match.index, reference.slice('ms:'.length), null);
            }
        }

        return (await Promise.all(icons)).filter(icon => icon != null);
    };
}

/** The shape icons of a `.diagram` file: one in front of each action of a `+aoe` statement, for the shape of its timeline action. */
export function diagramShapeIconProvider(documents: TextDocuments<TextDocument>, documentCache: ParserCache, settings: ThaliakTimelineLinterSettings): (params: OutlineParams) => Promise<StatusIcon[] | null> {
    return async (params) => {
        const textDocument = documents.get(params.uri);

        if (textDocument == null) {
            return null;
        }

        const timeline = timelineOf(documents, textDocument.uri);
        const raid = (timeline?.js ?? null) as UnprocessedRaidData | null;
        const enums = documentCache.getLinterOptions(settings).enums;
        const icons = tokensOf(textDocument.getText())
            .filter(token => token.statement?.verb === 'aoe' && token.kind === 'subject')
            .map(async (token): Promise<StatusIcon | null> => {
                const action = raid?.actions?.[baseOf(token.text)];

                if (action?.shape == null) {
                    return null;
                }

                const icon = await shapeIcon(enums, action.shape, action, () => raid);
                const position = { line: token.line, character: token.start };

                return icon != null ? { range: { start: position, end: position }, ...icon } : null;
            });

        return (await Promise.all(icons)).filter(icon => icon != null);
    };
}
