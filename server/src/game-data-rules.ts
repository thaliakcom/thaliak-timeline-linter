// The checks of thaliak's build that need game data, from `processAction()` and `processStatus()` in its `data.ts`.
// Ported rather than shared, as those functions also normalize the data, and thaliak's errors have no position.
// Checks that don't need game data are in `linter-rules.ts`.
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { GameAction, GameStatus, getGameAction, getGameStatus } from './ironworks';
import { LinterOptions } from './server';
import { MechanicType, ShapeType } from './types/enums';
import { WipKind } from './types/raids';
import { getEntry, getIfType, getRange } from './util';

/** The game's attack types as damage types, by `attackType` (thaliak's `ATTACK_TYPES`). */
const ATTACK_TYPES = ['mixed', 'physical', 'physical', 'physical', 'physical', 'magic', 'dark', 'physical', 'dark'];
/** The mechanic shapes each of the game's cast types can stand for (thaliak's `CAST_TYPES`). */
const CAST_TYPES: ShapeType[][] = [
    [],
    [],
    ['chariot', 'defamation', 'dynamo', 'star', 'in-or-out'],
    ['cone'],
    ['line'],
    ['chariot', 'defamation', 'in-or-out'],
    [],
    ['chariot', 'defamation', 'in-or-out'],
    ['line'],
    [],
    ['dynamo', 'in-or-out'],
    ['plus', 'cross'],
    ['line', 'halfroom', 'sides', 'rect', 'grid'],
    ['cone', 'halfroom', 'sides']
];
/** The mechanic types that a circle of an `effectRange` of 50 or more can be without being a raidwide (thaliak's `OMNI_MECHANIC_TYPES`). */
const OMNI_MECHANIC_TYPES: readonly MechanicType[] = ['mech.motion', 'mech.lookaway', 'mech.failure', 'mech.lookat', 'mech.status', 'raidwide.proximity', 'raidwide.proximity.fake', 'aoe.condition', 'mech.check', 'mech.los'];
/** The mechanic types that can have a shape on a cast type without an AoE (thaliak's `ANY_MECHANIC_TYES`). */
const ANY_MECHANIC_TYPES: readonly MechanicType[] = ['aoe.exaflares', 'aoe.delayed', 'aoe.aftershock'];

/** What a check found: `field` is the key that it's about, or else the action's or status's own key. `kind` is what `wip` can hold it back by. */
interface Problem {
    code: string;
    kind: WipKind | null;
    field?: string;
    message: string;
}

/**
 * What's wrong with an action, given its row in the game's data and that of its `hit` (`null` without one, `undefined` if
 * the game has no such action). As in thaliak's `processAction()`, the hit decides the damage type and element, and the
 * AoE unless it's one of the action's children; `hitIsChild` says whether it is.
 */
function* actionProblems(key: string, action: yaml.YAMLMap, game: GameAction, options: LinterOptions, hit: GameAction | null | undefined, hitIsChild: boolean): Generator<Problem> {
    const name = action.get('name');

    if (name == null) {
        if (game.name.length === 0) {
            yield { code: 'missing-name', kind: 'timeline', message: `The game's data has no name for '${key}', so it must be specified with 'name'.` };
        } else if (game.name.startsWith('_rsv')) {
            yield { code: 'encrypted-name', kind: 'timeline', message: `The name of '${key}' is encrypted in the game's data, so it must be specified with 'name'.` };
        }
    } else if (name === game.name) {
        yield { code: 'redundant-name', kind: 'timeline', field: 'name', message: `This is the same as the name in the game's data and should be removed.` };
    }

    // Game data decides these for an action with an ID; a different cast or hit is named with `id` and `hit` instead.
    for (const field of ['cast', 'type', 'element']) {
        if (action.get(field) != null) {
            yield { code: 'game-data-override', kind: 'timeline', field, message: `'${field}' isn't part of the in-game action, so it can't be set on an action with an 'id'. Use the real cast's 'id', and the action that deals the damage as its 'hit'.` };
        }
    }

    if (hit === undefined) {
        yield { code: 'unknown-hit', kind: 'timeline', field: 'hit', message: `The game's data has no action ${action.get('hit')}.` };
    }

    const damageAction = hit ?? game;
    const type = damageAction.attackType !== 0 || damageAction.aspect !== 0 || damageAction.canTargetHostile ? ATTACK_TYPES[damageAction.attackType] : undefined;
    const aoe = hitIsChild || hit == null ? game : hit;
    const damage = action.get('damage');

    if (typeof damage === 'number' && damage > 0 && type == null) {
        yield { code: 'missing-damage-type', kind: 'damage', field: 'damage', message: `This action has a damage value, but neither it nor the game's data has a damage type.` };
    }

    const mechanic = action.get('mechanic') as MechanicType | undefined;
    const shape = action.get('shape') as ShapeType | undefined;
    const mechanicType = mechanic != null ? options.enums['mechanic-types']?.yaml[mechanic] : undefined;
    const players = (action.get('players') as number | undefined) ?? mechanicType?.players;
    const children = action.get('children');
    const hasChildren = yaml.isSeq(children) && children.items.length > 0;

    // The AoE's game action: the hit, unless it's one of the children.
    const of = aoe === hit ? `its hit (${action.get('hit')})` : 'this action';

    if (aoe.castType > 1 && mechanic != null && mechanicType != null) {
        const shapes = CAST_TYPES[aoe.castType] ?? [];

        if (shapes.length > 0) {
            if (aoe.castType === 2 && aoe.effectRange >= 50 && (players == null || players < 8) && !OMNI_MECHANIC_TYPES.includes(mechanic)) {
                yield { code: 'raidwide-cast-type', kind: 'timeline', field: 'mechanic', message: `In the game's data, ${of} is cast type 2 (circle) with an effect range of ${aoe.effectRange}, which is a raidwide, but it's declared as a ${mechanic}.` };
            }

            if (shape != null && !shapes.includes(shape)) {
                yield { code: 'shape-cast-type', kind: 'timeline', field: 'shape', message: `In the game's data, ${of} is cast type ${aoe.castType} (${shapes.join(', ')}), but it's declared as a ${shape}.` };
            }
        }
    } else if (aoe.castType === 1 && shape != null && !ANY_MECHANIC_TYPES.includes(mechanic!) && !hasChildren) {
        yield { code: 'shape-cast-type', kind: null, field: 'shape', message: `In the game's data, ${of} is cast type 1 (no AoE), but it's declared as an AoE (${mechanic} ${shape}).` };
    }
}

/** What's wrong with a status effect, given its row in the game's data. */
function* statusProblems(key: string, status: yaml.YAMLMap, game: GameStatus, options: LinterOptions): Generator<Problem> {
    if (status.get('name') == null) {
        if (game.name.length === 0) {
            yield { code: 'missing-name', kind: 'timeline', message: `The game's data has no name for '${key}', so it must be specified with 'name'.` };
        } else if (game.name.startsWith('_rsv')) {
            yield { code: 'encrypted-name', kind: 'timeline', message: `The name of '${key}' is encrypted in the game's data, so it must be specified with 'name'.` };
        }
    }

    if (status.get('gameDescription') == null && game.description?.includes('_rsv')) {
        yield { code: 'encrypted-description', kind: 'guide', message: `The description of '${key}' is encrypted in the game's data, so it must be specified with 'gameDescription'.` };
    }

    const type = status.get('type') as string | undefined;
    const statusTypes = options.enums['status-types']?.yaml;

    if (type != null && status.get('isBuff') == null && statusTypes != null) {
        const expected = game.statusCategory === 1 ? 'buff' : 'debuff';
        const actual = statusTypes[type as keyof typeof statusTypes]?.type ?? ((status.get('affects') ?? 'player') === 'player' ? 'debuff' : 'buff');

        if (expected !== actual) {
            yield { code: 'status-category', kind: 'guide', field: 'type', message: `In the game's data, this status effect is a ${expected}, but according to its type it should be a ${actual}.` };
        }
    }
}

/**
 * The problems of the timeline's actions and status effects that need game data, which thaliak's build would report.
 * Empty if game data is off. A kind of problem that the timeline's `wip` holds back isn't reported, as in thaliak's build.
 */
export async function lintGameData(textDocument: TextDocument, document: yaml.Document, options: LinterOptions): Promise<Diagnostic[]> {
    const wip = document.get('wip');
    const isHeldBack = (kind: WipKind | null) => kind != null && (wip === 'full' || (yaml.isSeq(wip) && wip.items.some(item => yaml.isScalar(item) && item.value === kind)));

    /** The diagnostics of the entries of the top-level map `section`. */
    function lint<T>(section: string, gameDataOf: (id: number, item: yaml.YAMLMap) => Promise<T | null>, problemsOf: (key: string, item: yaml.YAMLMap, game: T, options: LinterOptions) => Iterable<Problem>): Promise<Diagnostic[]>[] {
        return (getIfType(document, section, yaml.isMap)?.items ?? []).map(async pair => {
            const id = yaml.isMap(pair.value) ? pair.value.get('id') : null;
            const game = typeof id === 'number' && yaml.isScalar(pair.key) && pair.key.range != null ? await gameDataOf(id, pair.value as yaml.YAMLMap) : null;

            if (game == null) {
                return [];
            }

            const map = pair.value as yaml.YAMLMap;
            const key = pair.key as yaml.Scalar;

            return [...problemsOf(String(key.value), map, game, options)]
                .filter(problem => !isHeldBack(problem.kind))
                .map(problem => ({
                    source: 'thaliak',
                    code: problem.code,
                    // Thaliak's build only warns about a problem that no `wip` kind can hold back.
                    severity: problem.kind == null ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
                    message: problem.message,
                    range: getRange(textDocument, ((problem.field != null ? getEntry(map, problem.field)?.key.range : null) ?? key.range)!)
                }));
        });
    }

    const actions = getIfType(document, 'actions', yaml.isMap);
    /** The game IDs of the timeline's actions, by key, to tell whether an action's `hit` is one of its children. */
    const idOf = (key: unknown) => {
        const action = actions?.get(key);
        return yaml.isMap(action) ? action.get('id') : undefined;
    };
    // An action's `hit` too: `null` without one, and `undefined` if the game has no such action.
    const withHit = async (id: number, map: yaml.YAMLMap): Promise<{ game: GameAction, hit: GameAction | null | undefined, hitIsChild: boolean } | null> => {
        const game = await getGameAction(id);
        const hitId = map.get('hit');
        const children = map.get('children');
        const hit = typeof hitId === 'number' ? await getGameAction(hitId) ?? undefined : null;
        const hitIsChild = typeof hitId === 'number' && yaml.isSeq(children) && children.items.some(child => yaml.isMap(child) && idOf(child.get('id')) === hitId);

        return game == null ? null : { game, hit, hitIsChild };
    };

    return (await Promise.all([
        ...lint('actions', withHit, (key, item, { game, hit, hitIsChild }, options) => actionProblems(key, item, game, options, hit, hitIsChild)),
        ...lint('status', getGameStatus, statusProblems)
    ])).flat();
}
