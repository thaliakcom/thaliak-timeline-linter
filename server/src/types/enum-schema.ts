import { AoeGraphicLookType, HeadmarkerLookType, LookTypeValue, TetherLookType } from './enums';

/**
 * @minimum 0
 * @asType integer
 */
type integer = number;

interface IdSet {
    [k: string]: integer;
}

interface NamedDescription {
    /** The item's name. */
    name: string;
    /** The item's description. */
    description: string;
}

/**
 * Aliases for ations and status effects that are likely to be referenced
 * in multiple timelines.
 * 
 * @title Common actions/statuses
 */
export interface Common {
    actions: IdSet;
    status: IdSet;
}

/** 
 * A list of damage types.
 * 
 * @title Damage types
 */
export interface DamageTypes {
    [k: string]: NamedDescription;
}

/** 
 * A list of available AoE shapes.
 * 
 * @title Mechanic shapes
 */
export interface MechanicShapes {
    [k: string]: MechanicShape;
}

interface MechanicShape extends NamedDescription {
    icon?: string;
}

/**
 * The look of an AoE in diagrams, by the game omen (`omenPath`, e.g. `general_1bf`) of its action.
 * AoEs whose omen isn't listed, and actions without an omen, look like `aoe`. `tower`, `exaflare` and
 * `circle-kb` draw that drawing over the AoE's circle.
 *
 * @title Omens
 */
export interface Omens {
    [omenPath: string]: LookTypeValue | AoeGraphicLookType;
}

/**
 * The headmarker look of each game headmarker, by its icon (`IconName` of the game's `Lockon` sheet, e.g.
 * `d1014trg_a0h`). Diagrams name headmarkers by these looks; a headmarker that isn't listed is `unknown`.
 *
 * @title Headmarkers
 */
export interface Headmarkers {
    [iconName: string]: Exclude<HeadmarkerLookType, 'unknown'>;
}

/**
 * The tether look of each game tether, by its file (`File` of the game's `Channeling` sheet, e.g.
 * `chn_teke01h`). Diagrams can use these looks without defining a tether; a tether that isn't listed is `unknown`.
 *
 * @title Tethers
 */
export interface Tethers {
    [file: string]: Exclude<TetherLookType, 'unknown'>;
}

interface MechanicType extends NamedDescription {
    /** Whether the mechanic must define a shape. */
    shapeful?: true;
    /** 
     * How many players one instance of this type of mechanic usually damages at a time. If this attribute is omitted, the player count must be explicitly specified if a damage component is provided.
     * 
     * @minimum 1
     * @maximum 8
     */
    players?: integer;
}

/** 
 * A list of mechanic types and what they mean.
 * 
 * @title Mechanic types
 */
export interface MechanicTypes {
    [k: string]: MechanicType;
}

interface StatusType extends NamedDescription {
    /** 
     * Whether this status effect type is a buff or debuff.
     * If not specified, assumes that it's a buff if the effect is on an enemy
     * and a debuff if the effect is on a player.
     */
    type?: 'buff' | 'debuff';
}

/** 
 * A list of status effect types and what they mean.
 * 
 * @title Status types
 */
export interface StatusTypes {
    [k: string]: StatusType;
}

/** 
 * A list of usable terms in timelines and what they mean.
 * 
 * @title Terms
 */
export interface Terms {
    [k: string]: string;
}
