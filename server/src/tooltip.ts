// Tooltips of actions and statuses for hovers and the tree view, laid out like thaliak's
// (`thaliak/src/eleventy/utility/transform-value.ts`, `transforms/templates.ts`): a header with the
// icon, name and caption, the description with its templates resolved, then the game data.
// Game data is merged into the timeline's entries like thaliak's `processAction()` and
// `processStatus()` (`thaliak/src/eleventy/utility/data.ts`).
import * as fs from 'fs';
import * as paths from 'path';
import { getGameAction, getGameBNpcBase, getGameIcon, getGameModelSkeleton, getGameStatus, type GameAction, type GameIcon } from './ironworks';
import type { LinterOptions } from './server';
import type { BaseTimelineItem, UnprocessedAction, UnprocessedRaidData, UnprocessedStatusEffect } from './types/raids';
import { formatTime } from './util';

/** The icon ID of game data entries without an icon (thaliak's `DEFAULT_IMAGE`). */
const DEFAULT_IMAGE = 405;
/** The hitbox radius in yalms of players and of enemies without one in game data (thaliak's `DEFAULT_HITBOX_RADIUS`). */
const DEFAULT_HITBOX_RADIUS = 0.5;
/** The cast types whose `effectRange` is measured from the edge of the caster's hitbox (thaliak's `PADDED_CAST_TYPES`). */
const PADDED_CAST_TYPES = [3, 4, 5];
/** The colour of names that templates were replaced with (a slightly purplish white). Hover HTML only allows hex colours. */
const TEMPLATE_NAME_COLOR = '#9b93d1';
/** How deep `:d` templates (which insert a description with its own templates) are resolved. */
const MAX_DEPTH = 3;

/** The game's attack types as damage types, by `attackType` (thaliak's `ATTACK_TYPES`). */
const DAMAGE_TYPES = ['mixed', 'physical', 'physical', 'physical', 'physical', 'magic', 'dark', 'physical', 'dark'];
/** The game's aspects as elements, by `aspect` (thaliak's `ASPECTS`). */
const ELEMENTS = [undefined, 'fire', 'ice', 'wind', 'earth', 'lightning', 'water', undefined];

/** The game's attack types, by `attackType` (the comments of thaliak's `ATTACK_TYPES`). */
const ATTACK_TYPE_NAMES = ['Unknown', 'Slashing', 'Piercing', 'Blunt', 'Shot', 'Magic', 'Bless', 'Sound waves', 'Limit break'];
/** The game's cast types, by `castType` (the comments of thaliak's `CAST_TYPES`). */
const CAST_TYPE_NAMES = [
    undefined,
    'No AoE',
    'Circle (No Padding)',
    'Cone',
    'Static Length line',
    'Circle (With Padding)',
    'Proximity',
    'Circle (Ground Targeting)',
    'Player-targeted line',
    undefined,
    'Donut (No Padding)',
    'Cross (Two Lines)',
    'No padding static length line',
    'Cone (No Padding)'
];
/** The game's aspects, by `aspect` (thaliak's `ASPECTS`). */
const ASPECT_NAMES = [undefined, 'Fire', 'Ice', 'Wind', 'Earth', 'Lightning', 'Water', undefined];

/** The icon file in `media/shapes` of each mechanic shape. Keep in sync with `client/src/outline-icons.ts`. */
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

/** The extension's `media` directory. The server runs from `out/server/src`. */
const MEDIA = paths.resolve(__dirname, '..', '..', '..', 'media');

/**
 * Matches templates in descriptions: `[prefix:key<modifiers>]` and `[alias](prefix:key<modifiers>)`.
 * The modifiers are split off the key per prefix, since keys may contain colons.
 */
const TEMPLATE_REGEX = /\[(?<prefix>a|s|m|ms|st|dt|t|i):(?<rest>[^[\]\n]+?)\]|\[(?<alias>[^[\]\n]+?)\]\((?<aliasPrefix>a|s|m|ms|st|dt|t|i):(?<aliasRest>[^()\n]+?)\)/g;
/** The modifiers of a status template: `:c`, `:d`, or stacks and a duration (thaliak's `STATUS_REGEX`). */
const STATUS_MODIFIERS = /(?::(?<modifier>c|d)|(?::(?<stacks>[1-9]\d*))?(?::(?<duration>[1-9]\d*)s)?)$/;
/** The modifiers of other templates: `:c` or `:d`. */
const MODIFIERS = /(?::(?<modifier>c|d))?$/;

const numberFormatOptions: Intl.NumberFormatOptions = { style: 'decimal', useGrouping: 'min2', maximumFractionDigits: 0 };
const secondsFormatOptions: Intl.NumberFormatOptions = { style: 'unit', unit: 'second', unitDisplay: 'narrow', minimumFractionDigits: 0, maximumFractionDigits: 1 };

/** The data a tooltip is built from. */
export interface TooltipContext {
    /** The timeline file, as plain data. */
    raid: UnprocessedRaidData | null;
    enums: LinterOptions['enums'];
}

/** A status reference's stack count and fixed duration. */
interface StatusReference {
    stacks: number;
    durationSeconds?: number;
}

/** An action or status by its key: its timeline entry (if it isn't a `common.yaml` alias) and its game ID. */
interface Entry<T> {
    definition: T | null;
    id: number | undefined;
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHtml(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Escapes game text for Markdown, keeping its line breaks. */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_[\]<>#|]/g, '\\$&').replaceAll('\n', '  \n');
}

/** Removes the colour markup of game descriptions (thaliak's `sanitizeApiDescription()`). */
function sanitizeGameDescription(text: string): string {
    return text.replaceAll(/(?:<UIForeground>[A-z0-9]+<\/UIForeground>)|(?:<UIGlow>[A-z0-9]+<\/UIGlow>)/g, '');
}

/** The game's name, unless it's empty or encrypted (`_rsv…`), which thaliak requires a timeline name for. */
function gameName(name: string | undefined): string | undefined {
    return name != null && name.length > 0 && !name.startsWith('_rsv') ? capitalize(name) : undefined;
}

const mediaUris = new Map<string, string>();

/** A file in `media` as a data URI. */
function mediaUri(...segments: string[]): string {
    const file = paths.join(MEDIA, ...segments);
    let uri = mediaUris.get(file);

    if (uri == null) {
        const type = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';

        uri = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
        mediaUris.set(file, uri);
    }

    return uri;
}

function iconUri(icon: GameIcon): string {
    return `data:image/png;base64,${icon.data.toString('base64')}`;
}

/** An image in the line of text. */
function inlineImage(src: string): string {
    return `<img src="${src}" height="16" align="absmiddle">`;
}

function lookupAction(context: TooltipContext, key: string): Entry<UnprocessedAction> | null {
    const definition = context.raid?.actions?.[key];

    if (definition != null) {
        return { definition, id: definition.id };
    }

    const id = context.enums.common?.yaml.actions[key];

    return id != null ? { definition: null, id } : null;
}

function lookupStatus(context: TooltipContext, key: string): Entry<UnprocessedStatusEffect> | null {
    const definition = context.raid?.status?.[key];

    if (definition != null) {
        return { definition, id: definition.id };
    }

    const id = context.enums.common?.yaml.status[key];

    return id != null ? { definition: null, id } : null;
}

/** The icon ID of a game data entry, unless it's the placeholder icon. */
function gameIconId(icon: number | undefined): number | undefined {
    return icon != null && icon !== DEFAULT_IMAGE ? icon : undefined;
}

/** The icon of the status `key`'s game ID `id` for `stacks` stacks: the timeline's `icon`, else the game's. */
export async function getStatusIcon(id: number, iconOverride: unknown, stacks: number = 1): Promise<GameIcon | null> {
    const icon = typeof iconOverride === 'number' ? iconOverride : gameIconId((await getGameStatus(id))?.icon);

    return icon != null ? getGameIcon(icon + stacks - 1) : null;
}

/** The hitbox radius in yalms of the battle NPC `source` (thaliak's `getHitboxRadius()`). */
async function hitboxRadius(source: number | undefined): Promise<number> {
    const bnpcBase = source != null ? await getGameBNpcBase(source) : null;

    if (bnpcBase == null) {
        return DEFAULT_HITBOX_RADIUS;
    }

    let radius = bnpcBase.modelCharaRadius;

    if (radius === 0) {
        const skeletonId = bnpcBase.modelCharaType === 3 ? bnpcBase.modelCharaModel
            : bnpcBase.modelCharaType === 2 ? 10000 + bnpcBase.modelCharaModel
            : undefined;
        const skeleton = skeletonId != null ? await getGameModelSkeleton(skeletonId) : null;

        radius = skeleton?.radius ?? DEFAULT_HITBOX_RADIUS;
    }

    return radius * bnpcBase.scale;
}

/** The action's `effectRange`, plus the caster's hitbox radius for padded cast types (thaliak's `paddedEffectRange()`). */
function paddedEffectRange(action: GameAction, radius: number): number {
    const padding = action.effectRange > 0 && PADDED_CAST_TYPES.includes(action.castType) ? radius : 0;

    return Math.round((action.effectRange + padding) * 1000) / 1000;
}

/** `value (name)`, or just `value` if `names` has no name for it. */
function enumValue(value: number, names: (string | undefined)[]): string {
    const name = names[value];

    return name != null ? `${value} (${name})` : String(value);
}

/**
 * The details section at the bottom of a tooltip: thaliak's additional information (cast, damage, …)
 * and the raw game data fields, one per line, as `` `field`: value ``. `null` if there are none.
 */
function details(values: Record<string, string | number | boolean>): string | null {
    const lines = Object.entries(values).map(([field, value]) => `\`${field}\`: ${value}`);

    return lines.length > 0 ? `---\n\n${lines.join('  \n')}` : null;
}

/** The name a template was replaced with, coloured to set it apart from the text around it. */
function templateName(name: string): string {
    return `<strong><span style="color:${TEMPLATE_NAME_COLOR};">${escapeHtml(name)}</span></strong>`;
}

/**
 * The header of a tooltip (thaliak's `.tooltip-header`): the icon, next to the name with its suffix
 * and below that the caption (with its icons).
 */
function header(icon: string | undefined, name: string, nameSuffix: string | undefined, captionIcons: string[], caption: string | undefined): string {
    const title = `<strong>${escapeHtml(capitalize(name))}</strong>${nameSuffix != null ? ` <em>${escapeHtml(capitalize(nameSuffix))}</em>` : ''}`;
    const captionLine = caption != null ? `${captionIcons.map(src => `${inlineImage(src)} `).join('')}${escapeHtml(capitalize(caption))}` : null;
    const text = [title, captionLine].filter(line => line != null).join('<br>');

    return `<table><tr>${icon != null ? `<td><img src="${icon}" height="40"></td>` : ''}<td>${text}</td></tr></table>`;
}

/** The name of the action `key` as thaliak shows it: the timeline's `name`, else the game's, else the key. */
async function actionName(context: TooltipContext, key: string): Promise<string> {
    const action = lookupAction(context, key);

    if (action?.definition?.name != null) {
        return action.definition.name;
    }

    return gameName(action?.id != null ? (await getGameAction(action.id))?.name : undefined) ?? key;
}

/** The name of the status `key` as thaliak shows it: the timeline's `name`, else the game's, else the key. */
async function statusName(context: TooltipContext, key: string): Promise<string> {
    const status = lookupStatus(context, key);

    if (status?.definition?.name != null) {
        return status.definition.name;
    }

    return gameName(status?.id != null ? (await getGameStatus(status.id))?.name : undefined) ?? key;
}

/** The game description of the action `key`, if it has no timeline entry (like thaliak's actions from `common.yaml`). */
async function actionDescription(context: TooltipContext, key: string): Promise<string | undefined> {
    const action = lookupAction(context, key);

    if (action?.definition != null) {
        return action.definition.description;
    }

    const description = action?.id != null ? (await getGameAction(action.id))?.description : undefined;

    return description != null ? escapeMarkdown(sanitizeGameDescription(description)) : undefined;
}

/**
 * Resolves the templates in the timeline text `text` like thaliak does: action and status references
 * become their names (statuses with their icon), enum references their names, `:d` their description,
 * `[fight]` and `[boss]` the fight's names. Unknown references are shown as code.
 */
export async function renderText(context: TooltipContext, text: string, depth: number = 0): Promise<string> {
    const replacements: Promise<string>[] = [];
    const matches = [...text.matchAll(TEMPLATE_REGEX)];

    for (const match of matches) {
        replacements.push(renderTemplate(context, match, depth).then(replacement => replacement ?? `\`${match[0]}\``));
    }

    const rendered = await Promise.all(replacements);
    let result = '';
    let index = 0;

    matches.forEach((match, i) => {
        result += text.slice(index, match.index) + rendered[i];
        index = match.index + match[0].length;
    });

    result += text.slice(index);

    result = result.replaceAll(/:unverified\(([^()]+?)\)/g, '$1');

    if (context.raid?.name != null) result = result.replaceAll('[fight]', context.raid.name);
    if (context.raid?.boss != null) {
        result = result.replaceAll('[boss:c]', capitalize(context.raid.boss)).replaceAll('[boss]', context.raid.boss);
    }

    return result;
}

/** The replacement of one template match, or `null` if it refers to nothing known. */
async function renderTemplate(context: TooltipContext, match: RegExpExecArray, depth: number): Promise<string | null> {
    const groups = match.groups!;
    const prefix = groups.prefix ?? groups.aliasPrefix!;
    const rest = groups.rest ?? groups.aliasRest!;
    const alias = groups.alias;
    const modifiers = (prefix === 's' ? STATUS_MODIFIERS : MODIFIERS).exec(rest)!;
    const key = rest.slice(0, modifiers.index);
    const modifier = modifiers.groups?.modifier;
    const describe = async (description: string | undefined) => description != null && depth < MAX_DEPTH ? renderText(context, description, depth + 1) : null;
    const name = (value: string) => modifier === 'c' ? capitalize(value) : value;
    const enums = context.enums;

    switch (prefix) {
        case 'a': {
            if (lookupAction(context, key) == null) return null;
            if (modifier === 'd') return describe(await actionDescription(context, key));

            const caption = lookupAction(context, key)?.definition?.caption;

            return `${templateName(name(alias ?? await actionName(context, key)))}${caption != null ? ` *${escapeHtml(caption)}*` : ''}`;
        }
        case 's': {
            const status = lookupStatus(context, key);

            if (status == null) return null;
            if (modifier === 'd') return describe(status.definition?.description);

            const stacks = modifiers.groups?.stacks != null ? Number.parseInt(modifiers.groups.stacks) : 1;
            const icon = status.id != null ? await getStatusIcon(status.id, status.definition?.icon, stacks) : null;
            const duration = modifiers.groups?.duration != null ? ` ${modifiers.groups.duration}s` : '';

            return `${icon != null ? `${inlineImage(iconUri(icon))} ` : ''}${templateName(name(alias ?? await statusName(context, key)))}${duration}`;
        }
        case 't': {
            const term = enums.terms?.yaml[key];

            if (term == null) return null;

            return modifier === 'd' ? describe(term) : templateName(name(alias ?? key));
        }
        case 'm':
        case 'ms':
        case 'st':
        case 'dt': {
            const collection = { 'm': enums['mechanic-types'], 'ms': enums['mechanic-shapes'], 'st': enums['status-types'], 'dt': enums['damage-types'] }[prefix]?.yaml as Record<string, { name: string, description: string }> | undefined;
            const item = collection?.[key];

            if (item == null) return null;

            return modifier === 'd' ? describe(item.description) : templateName(name(alias ?? item.name));
        }
        default:
            // `i:` sub-icons are thaliak's own images, which the extension doesn't have.
            return null;
    }
}

/** Timeline text with its templates resolved and, like thaliak, a paragraph per line (Markdown would join them). */
async function renderParagraphs(context: TooltipContext, text: string): Promise<string> {
    return (await renderText(context, text.trim())).replaceAll(/\n+/g, '\n\n');
}

/** An action's `description` with thaliak's `resolve`, `tips`, `mistakes` and `trivia` sections (thaliak's `wrapDescription()`). */
async function wrapDescription(context: TooltipContext, description: string, resolve?: string, tips?: string[], mistakes?: string[], trivia?: string): Promise<string> {
    const parts = [await renderParagraphs(context, description)];

    if (resolve != null) parts.push(`**How to resolve:** ${await renderParagraphs(context, resolve)}`);
    if (tips != null) parts.push(`**Tips:**\n\n${(await Promise.all(tips.map(tip => renderText(context, tip)))).map(tip => `* ${tip}`).join('\n')}`);
    if (mistakes != null) parts.push(`**Common mistakes:**\n\n${(await Promise.all(mistakes.map(mistake => renderText(context, mistake)))).map(mistake => `* ${mistake}`).join('\n')}`);
    if (trivia != null) parts.push(`**Trivia:** ${await renderParagraphs(context, trivia)}`);

    return parts.join('\n\n');
}

/** Whether `id` is one of the special timeline IDs (`<phase>`, …). */
function isSpecial(id: string): boolean {
    return id.startsWith('<');
}

/** The tooltip of the action `key` (thaliak's action tooltip), or `null` if there is no such action. */
export async function actionTooltip(context: TooltipContext, key: string): Promise<string | null> {
    const action = lookupAction(context, key);

    if (action == null) {
        return null;
    }

    const definition: Partial<UnprocessedAction> = action.definition ?? {};
    const game = action.id != null ? await getGameAction(action.id) : null;
    const name = definition.name ?? gameName(game?.name) ?? key;
    const iconId = definition.icon ?? gameIconId(game?.icon);
    const icon = iconId != null ? await getGameIcon(iconId) : null;
    const isPlayerSource = definition.isPlayerSource ?? game?.isPlayerAction ?? false;
    const source = isPlayerSource ? 'player' : 'enemy';
    let type: string | undefined = definition.type;
    let element: string | undefined = definition.element;

    if (game != null && (game.attackType !== 0 || game.aspect !== 0 || game.canTargetHostile)) {
        type = DAMAGE_TYPES[game.attackType];
        element = ELEMENTS[game.aspect];
    }

    const effectRange = game != null ? paddedEffectRange(game, await hitboxRadius(definition.source)) : 0;
    const cast = definition.cast ?? (game?.cast100ms ?? 0) * 100;
    const captionIcons: string[] = [];
    let caption: string;

    if (definition.mechanic == null) {
        captionIcons.push(mediaUri('caption', `${source}.png`));
        caption = 'Action';
    } else {
        captionIcons.push(element != null ? mediaUri('caption', 'elements', `${element}.png`) : mediaUri('caption', `${type ?? source}.png`));

        const mechanicName = context.enums['mechanic-types']?.yaml[definition.mechanic]?.name ?? definition.mechanic;

        if (definition.shape != null) {
            const shapeName = context.enums['mechanic-shapes']?.yaml[definition.shape]?.name ?? definition.shape;

            caption = `${effectRange > 0 ? `${effectRange}y ` : ''}${shapeName} ${mechanicName}`;
        } else {
            caption = mechanicName;
        }
    }

    if (definition.shape != null && context.enums['mechanic-shapes']?.yaml[definition.shape]?.icon != null && SHAPE_FILES[definition.shape] != null) {
        captionIcons.push(mediaUri('shapes', `${SHAPE_FILES[definition.shape]}.svg`));
    }

    const information: Record<string, string> = {};

    if (cast > 0) {
        information.Cast = (cast / 1000).toLocaleString('en-GB', secondsFormatOptions);
    }

    const children = (definition.children ?? []).filter((child): child is BaseTimelineItem => !isSpecial(child.id));
    let childDamage = 0;
    const childLines: string[] = [];

    for (const child of children) {
        const childAction = lookupAction(context, child.id);
        const childDefinition = childAction?.definition;
        const childCaption = childDefinition?.caption != null ? ` *${escapeHtml(capitalize(childDefinition.caption))}*` : '';
        const count = child.count != null ? ` ×${child.count}` : '';
        const childDescription = child.description ?? childDefinition?.description ?? await actionDescription(context, child.id);

        childLines.push(`* \`${formatTime(child.at)}\` **${escapeHtml(capitalize(await actionName(context, child.id)))}**${childCaption}${count}${childDescription != null ? ` — ${(await renderText(context, childDescription)).replaceAll('\n', ' ')}` : ''}`);
        childDamage += childDefinition?.damage ?? 0;
    }

    if (childDamage > 0) {
        information['Damage (total)'] = (childDamage + (definition.damage ?? 0)).toLocaleString('en-GB', numberFormatOptions);
    }

    if (definition.damage != null && definition.damage > 0) {
        information[childDamage > 0 ? 'Damage (initial hit)' : 'Damage'] = definition.damage.toLocaleString('en-GB', numberFormatOptions);
    }

    const description = action.definition != null
        ? await wrapDescription(context, definition.description ?? '', definition.resolve, definition.tips, definition.mistakes, definition.trivia)
        : escapeMarkdown(sanitizeGameDescription(game?.description ?? ''));
    const parts = [header(icon != null ? iconUri(icon) : undefined, name, definition.caption, captionIcons, caption)];

    if (description.trim() !== '') parts.push(description);
    if (childLines.length > 0) parts.push(childLines.join('\n'));

    const values: Record<string, string | number | boolean> = { ...information };

    if (game != null) {
        if (game.cast100ms > 0) values.castTime = `${game.cast100ms / 10} s`;
        values.range = game.range;
        values.effectRange = game.effectRange;
        values.attackType = enumValue(game.attackType, ATTACK_TYPE_NAMES);
        values.aspect = enumValue(game.aspect, ASPECT_NAMES);
        values.castType = enumValue(game.castType, CAST_TYPE_NAMES);
        values.XAxisModifier = game.XAxisModifier;
        if (game.omenPath != null) values.omenPath = game.omenPath;
    }

    const detailSection = details(values);

    if (detailSection != null) parts.push(detailSection);

    return parts.join('\n\n');
}

/** The tooltip of the status `key` (thaliak's status tooltip), or `null` if there is no such status. */
export async function statusTooltip(context: TooltipContext, key: string, reference: StatusReference = { stacks: 1 }): Promise<string | null> {
    const status = lookupStatus(context, key);

    if (status == null) {
        return null;
    }

    const definition: Partial<UnprocessedStatusEffect> = status.definition ?? {};
    const game = status.id != null ? await getGameStatus(status.id) : null;
    const name = definition.name ?? gameName(game?.name) ?? key;
    const icon = status.id != null ? await getStatusIcon(status.id, definition.icon, reference.stacks) : null;
    const isBuff = definition.isBuff ?? game?.statusCategory === 1;
    const affects = definition.affects ?? 'player';
    const statusType = definition.type != null ? context.enums['status-types']?.yaml[definition.type]?.name ?? definition.type : null;
    const caption = statusType ?? (isBuff ? 'Enhancement' : 'Enfeeblement');
    const maxStacks = definition.maxStacks ?? game?.maxStacks ?? 0;
    const information: Record<string, string> = {};

    if (reference.durationSeconds != null) {
        information.Duration = `${reference.durationSeconds}s`;
    }

    if (maxStacks > 1) {
        information['Maximum stacks'] = maxStacks.toLocaleString('en-GB', numberFormatOptions);
    }

    if (definition.tick != null) {
        information['Damage per tick'] = reference.durationSeconds != null
            ? `${definition.tick.toLocaleString('en-GB', numberFormatOptions)} × ${Math.trunc(reference.durationSeconds / 3)}`
            : `${definition.tick.toLocaleString('en-GB', numberFormatOptions)} every 3s`;
    }

    const gameDescription = definition.gameDescription ?? sanitizeGameDescription(game?.description ?? '');
    const parts = [header(icon != null ? iconUri(icon) : undefined, name, undefined, [mediaUri('caption', `${affects}.png`)], caption)];

    if (definition.description != null) parts.push(await renderParagraphs(context, definition.description));

    // Thaliak hides encrypted (`_rsv…`) game descriptions. A timeline's override may contain templates.
    if (gameDescription !== '' && !gameDescription.includes('_')) {
        parts.push(`*${definition.gameDescription != null ? await renderText(context, gameDescription) : escapeMarkdown(gameDescription)}*`);
    }

    const gameValues: Record<string, string | number | boolean> = game != null ?{ maxStacks: game.maxStacks, canDispel: game.canDispel, isPermanent: game.isPermanent, statusCategory: enumValue(game.statusCategory, [undefined, 'Buff', 'Debuff']) } : {};
    const detailSection = details({ ...information, ...gameValues });

    if (detailSection != null) parts.push(detailSection);

    return parts.join('\n\n');
}

/** The tooltip of `symbol` (`a:<key>` or `s:<key>`), or `null` if it's neither or unknown. */
export function symbolTooltip(context: TooltipContext, symbol: string): Promise<string | null> {
    if (symbol.startsWith('a:')) return actionTooltip(context, symbol.slice(2));
    if (symbol.startsWith('s:')) return statusTooltip(context, symbol.slice(2));

    return Promise.resolve(null);
}
