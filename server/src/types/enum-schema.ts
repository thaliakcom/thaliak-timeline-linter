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

interface Animation {
    /** The element types the animation can be used on: all of them, only shapes, or a list of element types. */
    elements: 'all' | 'shapes' | string[];
    /** The parameters the animation takes (keys of `enums/parameters.yaml`), e.g. `{ name: fade, speed: 2 }`. */
    params?: string[];
}

/**
 * A list of the animations diagram elements can play when they appear (`enter`) or disappear (`exit`).
 *
 * @title Animations
 */
export interface Animations {
    /** The animations elements can play when they appear. */
    enter: Record<string, Animation>;
    /** The animations elements can play when they disappear. */
    exit: Record<string, Animation>;
}

/**
 * A list of the looks diagram shapes and links can be drawn with.
 *
 * @title Looks
 */
export interface Looks {
    /** The looks of shapes (`look` on ellipses, rectangles, cones and donuts). */
    aoes: Record<string, LookParameters>;
    /** The looks of links (`look` on links). */
    tethers: Record<string, LookParameters>;
    /** The markers (`look` on markers). */
    markers: Record<string, LookParameters>;
}

/** The parameters a look takes (keys of `enums/parameters.yaml`), e.g. `{ name: ripple, speed: 2 }`; empty if none. */
type LookParameters = string[] | null;

interface Parameter {
    /** What the parameter does. Every parameter is a factor of the normal value (default 1). */
    description: string;
    /** The smallest value allowed. */
    minimum: number;
    /** The largest value allowed. */
    maximum: number;
}

/**
 * The parameters looks and animations can take (`look: { name: ripple, speed: 2 }`).
 *
 * @title Parameters
 */
export interface Parameters {
    [k: string]: Parameter;
}
