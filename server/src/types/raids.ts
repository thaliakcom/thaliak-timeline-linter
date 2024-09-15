import { MechanicType, DamageType, StatusType, ShapeType } from './enums';
import { Graphing } from './graphing';

/** 
 * @minimum 0
 * @asType integer
 */
type integer = number;

export interface StatusEffect extends UnprocessedStatusEffect {
    name: string;
    gameDescription: string;
    isBuff: boolean;
    maxStacks: integer;
    isPlayerSource: boolean;
    duration: integer[];
}

export interface UnprocessedStatusEffect {
    /**
     * If specified, will use this ID to retrieve additional information
     * about the status from game data. If not specified, will use the
     * key of this status instead.
     *
     * Note that timeline items and in-text references still use the key
     * of the status to retrieve additional action data.
     *
     * While not necessary, using this field is generally recommended to
     * "alias" statuses used in the fight to make the timeline easier to
     * read and maintain.
     */
    id?: number;
    /**
     * Can be used to override the name of the status effect.
     * Note that the status name is automatically retrieved from game data
     * based on the status ID, so overriding this value is only necessary
     * if there is no game data entry for this status, or when the game data name
     * is incorrect.
     */
    name?: string;
    /**
     * The icon ID of the status effect. Note that this ID is
     * automatically retrieved from game data, so explicitly defining it is strongly discouraged.
     */
    icon?: number;
    /**
     * How long the status effect lasts (in milliseconds).
     * If the status effect has multiple variations with different durations,
     * you can supply an array instead of a single number here.
     * If the status effect does not have a fixed duration
     * (and therefore lasts indefinitely or until cleared by another mechanic),
     * leave this field blank.
     */
    duration?: integer | integer[];
    /**
     * The type of the status effect. Must be one of the values from `status-types.yaml`.
     * Leave blank if none of these apply.
     */
    type?: StatusType;
    /** A detailed description of the status effect. */
    description?: string;
    /** 
     * If this status effect represents a damage-over-time debuff, this field
     * can be used to specify its damage per tick.
     */
    tick?: integer;
    /**
     * The in-game text of the status effect that appears when you hover over the effect.
     * Note that this value is automatically retrieved from game data, so explicitly defining
     * it here is strongly discouraged.
     */
    gameDescription?: string;
    /**
     * Whether this status effect represents a buff (enhancement) or debuff (enfeeblement).
     * Note that this value is automatically retrieved from game data, so explicitly defining
     * it here is strongly discouraged.
     */
    isBuff?: boolean;
    /**
     * If the status effect can be stacked, the maximum number of stacks.
     * Note that this value is automatically retrieved from game data, so explicitly defining
     * it here is strongly discouraged.
     */
    maxStacks?: integer;
    /**
     * Whether the status effect originates from a player or an enemy.
     * Note that this value is automatically retrieved from game data, so explicitly defining
     * it here is strongly discouraged.
     */
    isPlayerSource?: boolean;
}

export interface Strategy {
    /** A human-readable name for the strategy or mechanical variation. */
    name: string;
    /** A description of the strategy or mechanical variation. */
    description?: string;
    /** If true, marks this strategy as being common in party finder. */
    common?: true;
    /** If true, marks this strategy as being recommended. */
    recommended?: true;
}

export interface Action extends Omit<UnprocessedAction, 'children'> {
    name: string;
    cast: integer;
    isPlayerSource: boolean;
    strategies: Record<string, Strategy>;
    children: (ProcessedTimelineItem | SpecialChildTimelineItem)[];
}

export enum CompactMode {
    /** Hides the description and reduces the space in-between children. */
    Full = 'full',
    /** Hides the description without reducing the space in-between children. */
    Trim = 'trim',
    /** Reduces space in-between children without hiding the description. */
    Space = 'space'
}

export type Element = 'fire' | 'ice' | 'wind' | 'earth' | 'lightning' | 'water';

export interface UnprocessedAction {
    /**
     * If specified, will use this ID to retrieve additional information
     * about the action from game data. If not specified, will use the
     * key of this action instead.
     *
     * Note that timeline items and in-text references still use the key
     * of the action to retrieve additional action data.
     *
     * While not necessary, using this field is strongly recommended to
     * "alias" actions used in the fight to make the timeline easier to
     * read and maintain.
     */
    id?: number;
    /**
     * Can be used to override the name of the action.
     * Note that the action name is automatically retrieved from game data
     * based on the action ID, so overriding this value is only necessary
     * if there is no game data entry for this action, or when the game data name
     * is incorrect.
     */
    name?: string;
    /**
     * What kind of a mechanic it is. Must be one of the values from
     * `attack-types.yaml`.
     *
     * Aside from being displayed in the timeline, the mechanic type also
     * determines how the mechanic is treated in the mitigation timeline.
     *
     * If a mechanic can be one of several types depending on which action
     * is cast, make two actions and link them using `link: or` in the timeline.  
     * If a mechanic can be one of several types but are not distinguished by
     * the action that is cast, prefer to place the damage instances into
     * a `children` list and link them using `link: or`.  
     * If the mechanic has no associated damage instance or linking them in this
     * way is otherwise impossible, consider creating a new entry in
     * `attack-types.yaml`.
     */
    mechanic?: MechanicType;
    /**
     * If the mechanic represents an AoE, what shape that AoE is. Must be one of
     * the values from `mechanic-shapes.yaml`.
     */
    shape?: ShapeType;
    /**
     * The type of damage applied. Must be one of the values from `damage-types.yaml`.
     * 
     * Note that this field is automatically retrieved from game data, so explicitly
     * specifying this field is strongly discouraged.
     *
     * Only specify this field for actual *damage instances*, not casts of
     * mechanics that involve damage instances in some way.
     */
    type?: DamageType;
    /** 
     * The type of element, if the damage is elemental. Only applicable to magic damage.
     * 
     * Note that this field is automatically retrieved from game data, so explicitly
     * specifying this field is strongly discouraged.
     */
    element?: Element;
    /**
     * The amount of damage this attack inflicts *on-content*.
     *
     * Note that if this damage is avoidable, you should set `players: 0`
     * (if this type of mechanic isn't usually avoidable).
     */
    damage?: integer;
    /**
     * The amount of damage this attack inflicts to tanks *on-content*.
     *
     * Should only be specified if this damage deals different amounts of damage
     * to tanks and other players.
     */
    'tank-damage'?: integer;
    /**
     * A detailed description of the action. Note that, unless there is only one
     * way to solve the mechanic, you should not mention specific strategies here;
     * instead use the `strategies` field for that.
     *
     * This description will be shown when users hover over the action name anywhere
     * on the page or when users expand timeline entries that reference this action.
     *
     * If a timeline entry referencing this action does not supply its own description,
     * the timeline entry will show the first line of this description in the row,
     * and the rest when expanded. This means that the first line of this description
     * should ideally be short and still make sense in isolation.
     */
    description: string;
    /** 
     * Marks the action as a major mechanic. These actions are highlighted in the,
     * making it easier to find the major actions at a glance.
     */
    major?: true;
    /**
     * The cast time in milliseconds.
     *
     * Note that this value is automatically retrieved from game data based on the ID, so
     * explicitly defining this field is only necessary if the game data value is wrong.
     *
     * Also note that this does not affect the timeline in any way. It is purely used
     * to provide additional information to the user.
     */
    cast?: integer;
    /** 
     * Describes how to resolve the mechanic, if it's not obvious from the description.
     *
     * Note that this should be a **general** description of how to resolve the mechanic
     * and should be independent of any specific strategy used.
     */
    resolve?: string;
    /**
     * An array of tips on how to deal with the mechanic.
     */
    tips?: string[];
    /**
     * An array of common mistakes and how to avoid them.
     */
    mistakes?: string[];
    /**
     * Some interesting trivia about this action that is ultimately useless to learning the
     * fight itself.
     */
    trivia?: string;
    /**
     * A map of unique strategy IDs to concrete strats or mechanical variations that can
     * be used in this mechanic.
     * Note that you can draw diagrams with multiple steps for a strategy under the `graphing`
     * key.
     */
    strategies?: Record<string, Strategy>;
    /**
     * "Sub-mechanics" that are executed as part of this main mechanic. Child mechanics denoted
     * here are initially hidden and only show up when the parent mechanic is expanded.
     *
     * Note that the `at` field is interpreted differently from the `at` field in the timeline
     * proper: in the timeline it's interpreted relative to the start of the encounter, whereas
     * this `at` field is interpreted relative to the time the parent action hits (so, generally
     * speaking, `n` milliseconds after the cast).
     */
    children?: (BaseTimelineItem | SpecialChildTimelineItem)[];
    /**
     * If set to `trim`, all child timeline items will display directly underneath
     * the parent ability name and will not display a description. As the description
     * column will be empty for all children, the children do not need to be aligned
     * underneath the parent's description. Useful for cases where the parent has
     * a long description and the children merely serve to illustrate the sequence
     * of events, not explain them.
     *
     * If set to `full`, the description is still hidden, but the space between child
     * elements is also minimized.
     */
    compact?: CompactMode;
    /** 
     * Specifies how many instances of this action come out at the same time.
     * If not specified, defaults to `1` unless overridden in a timeline item.
     */
    count?: integer;
    /**
     * If an action instance deals unavoidable damage to one or more players, this specifies
     * the number of players who take damage. If the action does not deal any damage,
     * or the damage is avoidable, this field should be set to `0`. Changes how the action
     * is interpreted by the mitigation view.
     *
     * The value of this field is automatically derived from its mechanic type, so it
     * should only be manually set if the number of targeted players differs from the
     * default value for this mechanic type.
     * 
     * Note that this field specifies the number of players who take damage **by a single
     * instance** of the action. For instance, for a spread-type mechanic, this field
     * should be set to `1`, not `8`, even though most spread-type mechanics target
     * all 8 players simultaneously, because in almost all cases all 8 players are
     * targeted by *distinct* instances of the action, not the same instance. To
     * specify the number of damage instances, use `count`.
     */
    players?: number;
    /**
     * The ID of the action icon. This is primarily meant for player actions and is
     * automatically filled from game data in that case. Monster actions do not have icons.
     */
    icon?: number;
    /**
     * Whether this is a player or enemy action. This value is automatically derived from
     * game data, so explicitly defining this field is strongly discouraged.
     */
    isPlayerSource?: boolean;
}

export interface ProcessedTimelineItem extends UnprocessedTimelineItem {
    at: integer;
    phaseAt: integer;
    expandable: boolean;
    count: integer;
}

export enum MitigationMode {
    /** Combines both damage instances. */
    Combine = 'combine',
    /** Uses one of two damage instances, whichever is higher. */
    Max = 'max'
}

export enum Timing {
    /** 
     * Indicates that the exact timing of this action is based on a *health
     * push*, i.e. it occurs when the health of the enemy or enemies on the
     * field is reduced past a certain threshold and not at a fixed time in
     * the fight.
     */
    Push = 'push',
    /** 
     * Indicates that the exact timing of this action is based on a *player
     * action*, i.e. it occurs when a player manually resolves a debuff or
     * interacts with a part of the arena in a specific way, and may therefore
     * vary.
     */
    Player = 'player'
}

export interface BaseTimelineItem {
    /**
     * The time in milliseconds relative to the `at` value of the parent ability
     * that this ability *hits*.
     *
     * A mechanic "hitting" is defined as follows:
     *
     * * If the action inflicts damage or statuses, it's at the time that that
     *   damage and statuses are **snapshot** on the player(s).
     * * If the action has a castbar but otherwise has no visible effect, it's
     *   at the end of the castbar.
     *
     * @minimum 0
     */
    at: integer;
    /**
     * The ID of the action executed. Should reference an action listed in `actions`.
     *
     * If the boss can cast different variations of this mechanic, use `link: or`.
     */
    id: integer | string;
    /**
     * A description of the action as it happens at this point in the timeline.
     * If not supplied, will default to the first line in the description of the referenced action.
     */
    description?: string;
    /** 
     * Describes how to resolve the mechanic, if it's not obvious from the description.
     *
     * Note that this should be a **general** description of how to resolve the mechanic
     * and should be independent of any specific strategy used.
     *
     * Also note that this is automatically derived from the associated action if available.
     */
    resolve?: string;
    /**
     * If this field is specified, this timeline item will be directly connected to the next
     * one with the given link tag. With the exception of `or`, a reader _could_ infer these
     * based on the timestamp of the mechanic, so those values merely serve to place extra
     * emphasis on whatever the value denotes.
     *
     * | tag    | meaning                                                              |
     * |--------|----------------------------------------------------------------------|
     * | `and`  | This mechanic and the next one occur at the same time.               |
     * | `or`   | The boss may use either this mechanic or the next one, but not both. |
     * | `then` | This mechanic and the next one resolve in rapid succession.          |
     */
    link?: 'and' | 'or' | 'then';
    /**
     * If this field is specified, it essentially serves as an override to the `link` type,
     * allowing you to change the way this damage instance flows into the mitigation timeline
     * without altering the way it's displayed.
     *
     * Possible options are `combine`, which takes the sum of this damage instance and the
     * next, and `max`, which takes the damage value of either this damage instance or the
     * next, whichever is higher.
     * 
     * If not specified, an `and` link defaults to `combine` and an `or` link defaults
     * to `max`.
     */
    mitigation?: MitigationMode;
    /** 
     * Specifies how many instances of this action come out at the same time.
     * Is automatically inherited from the associated `Action` if specified there.
     * If not specified, defaults to `1`.
     */
    count?: integer;
    /** 
     * The number of players damaged by this action. Should only be specified if the
     * this timeline item's player count differs from the player count defined within
     * the action itself.
     */
    players?: number;
    /** Allows specifying additional information about the timing of the action. */
    timing?: Timing;
    /** 
     * If true, completely hides the element from the timeline and instead
     * only prints its children.
     * Can be used to group a sequence of consecutive actions together that appear
     * in this sequence multiple times in the fight, avoiding the need to write
     * them out each time.
     */
    flatten?: boolean;
}

export interface Phase {
    /**
     * The full name of the phase. Phases aren't automatically numbered, so if
     * you want to number the phase, add the number to the name here.
     */
    name: string;
    /**
     * How much HP the enemy in this phase has. Used to calculate the required
     * DPS. If multiple enemies are fought in this phase, specify the sum total
     * of all their HP values here.
     */
    hp: number;
}

export interface UnprocessedTimelineItem extends BaseTimelineItem {
    /**
     * Can be used to override whether the timeline entry should be expandable or not.
     * By default the timeline entry is expandable if the timeline entry and the action
     * both have their own description, or when the timeline references strategies to show.
     */
    expandable?: boolean;
}

export interface Macro {
    /** A name for the macro. */
    name: string;
    /** The textual contents of the macro that can be copied and pasted into FFXIV. */
    text: string;
}

export interface EndPhaseItem extends Pick<BaseTimelineItem, 'at' | 'timing'> {
    id: '<endphase>';
}

export interface PhaseShiftItem extends Pick<BaseTimelineItem, 'at' | 'timing'> {
    id: '<phase>';
    /**
     * The full name of the phase. Phases aren't automatically numbered, so if
     * you want to number the phase, add the number to the name here.
     */
    name: string;
    /**
     * How much HP the enemy in this phase has. Used to calculate the required
     * DPS. If multiple enemies are fought in this phase, specify the sum total
     * of all their HP values here.
     */
    hp?: number;
    /**
     * Some phases don't require you to kill the enemy or enemies but instead
     * only require you to get their health past a certain HP threshold.
     * This HP threshold can be entered here, which will adjust the required DPS
     * accordingly.
     */
    maxhp?: number;
}

export interface TargetableItem extends Pick<BaseTimelineItem, 'at'> {
    id: '<targetable>' | '<untargetable>';
}

export interface StatusTimelineItem extends Omit<BaseTimelineItem, 'resolve' | 'mitigation' | 'id' | 'link'> {
    id: '<addstatus>' | '<removestatus>';
    status: string | string[];
}

export interface LoopItem extends Pick<BaseTimelineItem, 'at' | 'description'> {
    id: '<loop>';
}

export type SpecialTimelineItem = PhaseShiftItem | EndPhaseItem | SpecialChildTimelineItem | LoopItem;
export type SpecialChildTimelineItem = TargetableItem | StatusTimelineItem;

export type TimelineItem = ProcessedTimelineItem | SpecialTimelineItem;

export interface RaidData extends Omit<UnprocessedRaidData, 'actions' | 'timeline'> {
    sort_id: integer;
    HP: integer;
    party_hp: integer;
    name: string;
    suffix: string;
    requiredDPS: integer;
    wip: boolean;
    status: Record<string | integer, StatusEffect>;
    actions: Record<string | integer, Action>;
    timeline: TimelineItem[];
    macros: Macro[];
    spoiler: boolean;
}

export interface Contributor {
    /**
     * The lodestone ID of the contributor.
     *
     * @minimum 0
     */
    id: integer;
    /** 
     * The role of the contributor.
     * * Authors write large parts of the timeline themselves.
     * * Editors are responsible for proofchecking a finished timeline and
     *   making small corrections like fixing links, typos, damage numbers,
     *   and mechanical inaccuracies.
     * * Helpers help research the internals of the fight's mechanics but
     *   are otherwise not involved in the writing process.
     */
    role: 'author' | 'editor' | 'helper';
}

/**
 * Timeline data for a specific encounter.
 *
 * @title Raid data
 */
export interface UnprocessedRaidData {
    /**
     * The ID of the encounter. Must be a valid encounter in `ContentFinderCondition`.
     * Note that multiple encounters can use the same encounter ID, for instance for
     * two-phase fights (with a door boss). See {@link suffix}.
     *
     * @minimum 0
     */
    id: integer;
    /**
     * Normally, encounters are sorted by their `id` value in lists. However,
     * sometimes an encounter has a higher ID than its successor encounter(s).
     * In that case, you can use this field to override the `id` value for use
     * in encounter sorts only.
     *
     * @minimum 0
     */
    sort_id?: integer;
    /** Which patch the encounter was first released in. */
    patch: string;
    /**
     * The date this encounter page was first created.
     *
     * @format date
     */
    date: Date;
    /**
     * The date this encounter page was last modified.
     *
     * @format date
     */
    modified: Date;
    /** The contributor or contributor data. Can't be an empty array. */
    by: Contributor | Contributor[];
    /**
     * A text value representing the "tier" of the encounter.
     * If supplied, all encounters with a matching tier value will be grouped.
     */
    tier?: string;
    /** The English name of the main boss that is fought in this encounter. */
    boss: string;
    /**
     * Can be used to override the name of the encounter.
     * Note that the encounter name is automatically retrieved from the API,
     * so usage of this field is strongly discouraged.
     */
    name?: string;
    /**
     * A suffix that will be attached to the name of the encounter.
     * Useful in two-part fights.
     */
    suffix?: string;
    /**
     * The exact maximum HP value of the boss fought in this encounter.
     *
     * @minimum 0
     */
    HP?: integer;
    /**
     * The approximate number of hit points of party members *on content*.
     * Used to deliver information about required mitigation and healing.
     *
     * This field should specify the HP value of the squishiest non-undergeared
     * party member.
     *
     * This field is required if the timeline is not marked as `wip`.
     *
     * @minimum 0
     */
    party_hp?: integer;
    /** Information about the auto-attacks in this instance, if applicable. */
    autos?: {
        /** What target type the auto-attacks use. Must be one of the values from `mechanic-types.yaml`. */
        mechanic: MechanicType;
        /** What shape the auto-attacks are. Must be one of the values from `mechanic-shapes.yaml`. */
        shape?: ShapeType;
        /** What damage type the auto-attacks use. Must be one of the values from `damage-types.yaml`. */
        type: DamageType;
    };
    /**
     * A brief description of the encounter that will be displayed at the top of
     * the page. Do not use this field to go into detail on mechanics.
     */
    description: string;
    /**
     * If set, this encounter will be included in encounter lists, but the actual
     * encounter page will be replaced by a generic page informing users that
     * the encounter guide is still a work-in-progress.
     */
    wip?: boolean;
    /**
     * The status effects that appear in this encounter. Each status effect
     * is either its game data ID or (if there is no game data entry for it) a
     * unique string representing the status effect, and a data object
     * further describing it.
     */
    status?: Record<string | number, UnprocessedStatusEffect>;
    /**
     * The actions (mechanics) that appear in this encounter. Each action
     * is either its game data ID or (if there is no game data entry for it) a
     * unique string representing the action, and a data object
     * further describing it.
     */
    actions?: Record<string | number, UnprocessedAction>;
    /** The entire timeline of the fight, referencing actions from `actions`. */
    timeline?: (UnprocessedTimelineItem | SpecialTimelineItem)[];
    /**
     * Macros that can be copied and pasted into the FFXIV in-game macro editor
     * and describe some set of strats.
     */
    macros?: Macro[];
    /** The graphing information. Can be supplied to create diagrams. */
    graphing?: Graphing;
    /**
     * If set, this encounter will be marked as a spoiler encounter. Spoiler
     * encounters will have their image blurred in any listing in which it appears
     * until the user hovers over the encounter or disables spoiler blurring
     * in the settings menu.
     */
    spoiler?: boolean;
}

export interface RaidPageData {
    id: integer;
    sortId: integer;
    shorthand: string;
    category: string;
    data: RaidData;
    title: string;
    expansion: string;
    group: string;
    tags: string;
    banner: string;
    boss: string;
    by: Contributor[];
    patch: string;
    date: Date;
    modified: Date;
    background: string;
    requiredDPS: number;
    requiredTotalDPS: number;
}
