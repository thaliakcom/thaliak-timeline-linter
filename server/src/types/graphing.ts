export type Point = readonly [x: number, y: number];
export type PositivePoint = readonly [x: PositiveNumber, y: PositiveNumber];
export type Origin = readonly [x: RelativeNumber, y: RelativeNumber];
export type RotatedPoint = readonly [x: number, y: number, rotation: degrees];
export type CoordinateSystemPoint = readonly [x: number, y: number, coordinateSystem: CoordinateSystem];

/** 
 * @minimum 0
 * @maximum 1
 */
type RelativeNumber = number;

/** @minimum 0 */
type PositiveNumber = number;

/** 
 * @minimum -360
 * @maximum 360
 */
type degrees = number;

interface Colored {
    /** An HTML color string for this element. */
    color?: string;
}

interface BaseElementData {
    /** The opacity of the element. */
    opacity?: RelativeNumber;
    /** A description that users can view by hovering over the element. */
    description?: string;
}

interface SharedElementData extends BaseElementData {
    /**
     * The scale of the element, either as a `[scaleX, scaleY]` array or a single
     * number that specifies the scale on both axes.
     * Can also use `w` or `h` as shorthands if only one axis should be modified.
     */
    scale?: PositiveNumber | PositivePoint;
    /** 
     * The origin of the element as relative coordinates between `0` and `1`
     * where `(0.5, 0.5)` would represent the element's center (default).
     * This essentially "translates" the element by that value and thus
     * changes the way position and rotation data is interpreted.
     */
    origin?: Origin;
    /** 
     * The rotation of the element in degrees.
     * If this is a string, it's interpreted as an ID for another element within the same step
     * that this element should "look at".
     * Set `null` to keep the previous rotation.
     */
    rotate?: degrees | string | null;
    /** Whether the element is currently visible or not. Default is `true`. */
    visible?: boolean;
    /** 
     * The initial size of the element. Can either be an array of `[width, height]`
     * or a single number, in which case both width and height will be the same.
     * In subsequent steps, the element's size should only be changed through the `scale`
     * property, otherwise animations won't work.
     */
    size?: PositiveNumber | PositivePoint;
}

export interface DefinitionElementData extends SharedElementData {
    /** An override for the coordinate system for this element. */
    'coordinate-system'?: CoordinateSystem;
    /**
     * The element's extrusion in form of a number specifying the depth of the extrusion
     * and an HTML color string.
     */
    extrude?: `${PositiveNumber} ${string}`;
    /** Explicitly sorts this element into a group. */
    group?: string;
    /** Whether to render this element as a *planar* element. A planar element is affected by perspective. Default is `true`. */
    planar?: boolean;
    /** Whether the element should drop a shadow. */
    shadow?: boolean;
}

export const SpecialStatuses = {
    'dice-1': { name: 'First in Line', description: 'First to be targeted by the mechanic.', image: '/images/dice/1.png', size: 10 },
    'dice-2': { name: 'Second in Line', description: 'Second to be targeted by the mechanic.', image: '/images/dice/2.png', size: 10 },
    'dice-3': { name: 'Third in Line', description: 'Third to be targeted by the mechanic.', image: '/images/dice/3.png', size: 10 },
    'dice-4': { name: 'Fourth in Line', description: 'Fourth to be targeted by the mechanic.', image: '/images/dice/4.png', size: 10 },
    'dice-5': { name: 'Fifth in Line', description: 'Fifth to be targeted by the mechanic.', image: '/images/dice/5.png', size: 10 },
    'dice-6': { name: 'Sixth in Line', description: 'Sixth to be targeted by the mechanic.', image: '/images/dice/6.png', size: 10 },
    'dice-7': { name: 'Seventh in Line', description: 'Seventh to be targeted by the mechanic.', image: '/images/dice/7.png', size: 10 },
    'dice-8': { name: 'Eighth in Line', description: 'Eighth to be targeted by the mechanic.', image: '/images/dice/8.png', size: 10 },
    'mark1': { name: 'Marked 1', description: 'Marked as player 1.', image: '/images/markers/mark1.svg', size: 6 },
    'mark2': { name: 'Marked 2', description: 'Marked as player 2.', image: '/images/markers/mark2.svg', size: 6 },
    'mark3': { name: 'Marked 3', description: 'Marked as player 3.', image: '/images/markers/mark3.svg', size: 6 },
    'mark4': { name: 'Marked 4', description: 'Marked as player 4.', image: '/images/markers/mark4.svg', size: 6 },
    'mark5': { name: 'Marked 5', description: 'Marked as player 5.', image: '/images/markers/mark5.svg', size: 6 },
    'mark6': { name: 'Marked 6', description: 'Marked as player 6.', image: '/images/markers/mark6.svg', size: 6 },
    'mark7': { name: 'Marked 7', description: 'Marked as player 7.', image: '/images/markers/mark7.svg', size: 6 },
    'mark8': { name: 'Marked 8', description: 'Marked as player 8.', image: '/images/markers/mark8.svg', size: 6 },
    'jump': { name: 'Jump Target', description: 'Player is being targeted for a jump.', image: '/images/markers/jump.svg', size: 8 },
    'cross': { name: 'Cross', description: 'Linked with the other cross player.', image: '/images/sub-icons/cross.svg', size: 8 },
    'square': { name: 'Square', description: 'Linked with the other square player.', image: '/images/sub-icons/square.svg', size: 8 },
    'circle': { name: 'Circle', description: 'Linked with the other circle player.', image: '/images/sub-icons/circle.svg', size: 8 },
    'triangle': { name: 'Triangle', description: 'Linked with the other triangle player.', image: '/images/sub-icons/triangle.svg', size: 8 }
};

export interface StatusInfo {
    name: string;
    description: string;
    image: string;
    size?: number;
}

export type SpecialStatus = keyof typeof SpecialStatuses;

export interface StepElementData extends SharedElementData {
    /** Sets the `x` position. */
    x?: number;
    /** Sets the `y` position. */
    y?: number;
    /** 
     * Attaches this element to the element with the specified ID.
     * In this case, `x` and `y` are interpreted as offsets.
     */
    attach?: string | null;
    /** Allows you to override the coordinate system used for this step only. */
    'coordinate-system'?: CoordinateSystem;
    /** If you only need to supply a new scale for the width, not the height, you can use this field instead of `scale`. */
    w?: RelativeNumber;
    /** If you only need to supply a new scale for the height, not the width, you can use this field instead of `scale`. */
    h?: RelativeNumber;
    /** A list of status effect IDs to show. */
    status?: (string | number | SpecialStatus | StatusInfo)[];
    /** Allows you to add some text on top of the element itself. */
    text?: string;
    /** Sets the CSS `transform` property on this element during this step. */
    transform?: string;
    /** Sets the CSS `filter` property on this element during this step. */
    filter?: string;
}

export interface DonutDefinition extends DefinitionElementData, Colored {
    type: 'donut';
}

export interface EllipseDefinition extends DefinitionElementData, Colored {
    type: 'ellipse';
}

export interface ConeDefinition extends DefinitionElementData, Colored {
    type: 'cone';
    angle: number;
    /** 
     * Specifies an offset from north (in degrees).
     * This is different from the standard property `rotate` in that this field touches
     * the coordinates of the cone directly instead of simply applying a transform.
     */
    rotation?: number;
}

export interface ImageDefinition extends DefinitionElementData {
    type: 'image';
    /** A URL to the image to include. */
    image: string;
    /** Whether the image should be rendered in full (`rectangle`) or only as a circular cutout. */
    shape?: 'circle' | 'rectangle';
}

export interface RectangleDefinition extends DefinitionElementData, Colored {
    type: 'rectangle';
}

export interface PrismDefinition extends DefinitionElementData, Colored {
    type: 'prism';
    /** The depth of the element. */
    depth: number;
}

export interface LinkDefinition extends BaseElementData, Colored, Pick<SharedElementData, 'visible'> {
    type: 'link';
    width?: number;
}

export type ElementDefinition = DonutDefinition | EllipseDefinition | ConeDefinition | ImageDefinition | RectangleDefinition | LinkDefinition | PrismDefinition;

export interface DonutDelta extends StepElementData, Colored {
}

export interface EllipseDelta extends StepElementData, Colored {
}

export interface ConeDelta extends StepElementData, Colored {
    rotation?: number;
}

export interface ImageDelta extends StepElementData {
    image?: string;
}

export interface EnemyDelta extends StepElementData {
}

export interface RectangleDelta extends StepElementData, Colored {
}

export interface LinkDelta extends BaseElementData, Colored, Pick<StepElementData, 'visible'> {
    /** The element ID to link from. */
    from?: string | Point;
    /** The element ID to link to. */
    to?: string | Point;
    /** If you only need to supply a new scale for the width, not the height, you can use this field instead of `scale`. */
    w?: RelativeNumber;
    scale?: PositiveNumber | PositivePoint;
}

export interface Cast {
    text?: string;
    progress?: RelativeNumber;
    visible?: boolean;
}

export type ElementDelta = DonutDelta | EllipseDelta | ConeDelta | ImageDelta | EnemyDelta | RectangleDelta | LinkDelta | Point | CoordinateSystemPoint | RotatedPoint;

interface SpecialElementStep {
    /** Allows you to specify a castbar. */
    cast?: Cast;
}

interface ElementGraphStep {
    /** 
     * Each graph step uses as its key one of the unique element IDs defined in `elements` _or_
     * one of the following predefined IDs:
     * `boss`, `arena`, `enemy`, `T1`, `T2`, `H1`, `H2`, `M1`, `M2`, `R1`, `R2`, `players`, `DPS`, `tanks`, `healers`, `supports`.
     * 
     * The data then describes a *delta* of all of the properties that should change compared
     * to the previous step.
     * You can either supply an object with element-specific data, or an array with either 2 or 3 numbers.
     * If an array has 2 numbers, it is interpreted as position data. If an array has 3 numbers, it is
     * interpreted as position data + a rotation (in degrees).
     *
     * You can add an element type (defined in `elements`) multiple times to the graph by providing an ID
     * unique to that element type within the step data. All of the following variations are valid:
     * 
     * * `ELEMENT_TYPE: DELTA`: The simplest form of a step key. Allows you to add an element type only once.
     * * `ELEMENT_TYPE#ELEMENT_ID: DELTA`: A step key followed by a hash and a unique sub-ID. Allows you to add multiple elements
     *   per element type.
     * * `ELEMENT_TYPE#PARTIAL_ELEMENT_*_ID: DELTA`: A step key with a unique sub-ID that includes a wildcard (`*`). Allows you to define a delta
     *   for all elements where the sub-ID has any number of characters in place of the wildcard. For instance, `ELEMENT_TYPE#*`
     *   matches *all* elements of a given type. Be aware that only a single wildcard is currently permitted, and only in the element portion
     *   of the ID, not the element type. For more flexibility, use one of the other variations below.
     * * `ELEMENT_TYPE#NUMBER..NUMBER: DELTA`: Allows you to define a delta for all elements in the range. For instance,
     *   `my_element#1..3` matches `my_element#1`, `my_element#2`, and `my_element#3`.
     * * `ELEMENT_TYPE#PARTIAL_[SUB_ID_1, SUB_ID_2, ...]: DELTA`: The most powerful form of an element key. Allows you to match multiple
     *   elements by composing the element key with comma-separated values inside a bracket expression. Multiple brackets are valid too.
     *   For instance, `my_element#[stack, spread]_[1, 2]` matches `my_element#stack_1`, `my_element#stack_2`, `my_element#spread_1`, and `my_element#spread_2`.
     * * `ELEMENT_TYPE#PARTIAL_[NUMBER..NUMBER]: DELTA`: Same as the previous version, but allows you to input a range expression
     *   within the brackets.
     * * `ELEMENT_TYPE_1,ELEMENT_TYPE_2: DELTA`: Allows you to match multiple element types. Cannot be used with sub-IDs.
     */
    [key: string]: ElementDelta;
}

export type GraphStep = ElementGraphStep & SpecialElementStep;

export type CoordinateSystem = 'polar' | 'cartesian';

export type Def = `linear-gradient(${string})` | `radial-gradient(${string})`;

type SpecialElements = {
    boss?: DefinitionElementData;
};

export interface Graphing {
    /** 
     * Which coordinate system to use. Possible values are 'polar' and 'cartesian'.
     * The coordinate system changes how an element's position is interpreted.
     * Note that the coordinate system can be overridden on a per-element basis.
     * Default is `cartesian`.
     */
    'coordinate-system'?: CoordinateSystem;
    /** An object defining all elements used in any of the graphs. The left-hand side is a unique identifier for the element. */
    elements: Record<string, ElementDefinition> & SpecialElements;
    /** 
     * An object defining the graphs themselves, along with each of their steps.
     * The left-hand side is a unique identifier for the graph
     * that must correspond with a strategy defined on any action within `actions`.
     * The right-hand side is a list of steps, where each step is an object where each key
     * corresponds to an element.
     * 
     * The first step of each graph defines the elements themselves and their base state.
     * All subsequent steps define a *delta* for each element that changes the element's
     * state compared to the previous step.
     * As a result, **the first step for each graph must include every element you intend
     * to use in later steps**.
     */
    graphs: Record<string, GraphStep[]>;
    /** A list of additional definitions to include in the final SVG, alongside IDs to reference them by. */
    defs?: Record<string, Def>;
}
