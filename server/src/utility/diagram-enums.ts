// The looks, animations and parameters of diagram elements. They come from the renderer, so they're
// defined here instead of in the data repository; `scripts/generate-schema.mts` compiles them into
// `src/types/enums.ts` and the schemas, with each description shown on hover.

/** A parameter looks and animations can take, e.g. `look: { type: ripple, speed: 2 }`. */
export interface ParameterDefinition {
    /** What the parameter does. Every numeric parameter is a factor of the normal value (default 1). */
    readonly description: string;
    /** The type of the value: a number (the default) or an HTML color string. */
    readonly type?: 'number' | 'color';
    /** The smallest value allowed (numbers only). */
    readonly minimum?: number;
    /** The largest value allowed (numbers only). */
    readonly maximum?: number;
}

/** The parameters looks and animations can take. */
export const PARAMETERS = {
    speed: {
        description: 'How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).',
        minimum: 0.1,
        maximum: 10
    },
    height: {
        description: 'How high its raised parts rise, as a factor of their normal height (2 is twice as high).',
        minimum: 0.1,
        maximum: 5
    },
    length: {
        description: 'How long its moving part is, as a factor of its normal length (2 is twice as long).',
        minimum: 0.1,
        maximum: 20
    },
    opacity: {
        description: 'The opacity of the effect. If omitted, the opacity of the element itself is used.',
        minimum: 0,
        maximum: 1
    },
    color: {
        description: 'The colour it\'s drawn in, as an HTML color string. Replaces its own colour; with the `plain` look, the fill.',
        type: 'color'
    }
} as const satisfies Record<string, ParameterDefinition>;

/** The name of a parameter in {@link PARAMETERS}. */
export type ParameterKey = keyof typeof PARAMETERS;

/** A look of a shape, link or marker. Looks that take a `color` draw in that colour instead of their own; the others can be tinted with `filter`. */
export interface LookDefinition {
    readonly description: string;
    /** The parameters the look takes. */
    readonly params: readonly ParameterKey[];
}

/** The looks per kind of element. */
export const LOOKS = {
    /** The looks of shapes (`look` on ellipses, rectangles, cones and donuts). */
    aoes: {
        none: { description: 'No fill; only the `stroke` shows.', params: [] },
        plain: { description: 'Flat fill in `color`. Default.', params: ['color'] },
        aoe: { description: 'The standard orange AoE telegraph with a bright yellow rim; pulses.', params: ['speed', 'color'] },
        landslide: { description: 'Dark earth with bright jagged cracks and a jagged blue border (Titan\'s Landslide).', params: [] },
        sludge: { description: 'Yellow plates with molten seams and a dark magma border (sludge puddles).', params: [] },
        ripple: { description: 'Telegraph with rings rippling outwards (Titan\'s Weight of the Land).', params: ['speed', 'color'] },
        cracks: { description: 'Telegraph broken into plates by dark fissures.', params: ['color'] },
        flame: { description: 'Telegraph with rising flame turbulence.', params: ['speed', 'color'] },
        wormhole: { description: 'Black swirl turning in towards the centre, with grey highlights (TEA\'s wormhole). Circles.', params: ['speed'] }
    },
    /** The looks of links (`look` on links). */
    tethers: {
        plain: { description: 'A flat band of `color`, `width` wide. Default.', params: ['color'] },
        glow: { description: 'A bright core with a soft glow (Mid/Remote Glitch).', params: ['color'] },
        flicker: { description: 'A flickering line (generic unpassable tether).', params: ['speed'] },
        pulse: { description: 'Red dashes and white-hot blobs flowing towards the target, with a glow around it and rings pulsing outwards from it (passable tether, Blaster).', params: ['speed'] },
        strands: { description: 'A band of irregular width made of noisy strands drifting towards the target (Mesohigh).', params: ['speed'] },
        braid: { description: 'Strands twisting around each other, up to two colours (Far Patch).', params: ['speed'] },
        coil: { description: 'A filled ribbon twisted around itself (Near Patch).', params: ['speed'] },
        chain: { description: 'Interlinked chain links (Infernal Fetters).', params: ['color'] },
        jagged: { description: 'A thin, angular line writhing slowly (orb tethers).', params: ['speed', 'color'] },
        unknown: { description: 'A glow with question marks along it: a tether whose game file no look is mapped to yet (`enums/tethers.yaml`).', params: [] }
    },
    /** The markers (`look` on markers). */
    markers: {
        'circle-kb': { description: 'Chevrons pointing and moving outwards all around (knockback from the centre).', params: ['speed'] },
        exaflare: { description: 'Arrowheads sliding across an orange-rimmed disc (exaflare direction).', params: ['speed'] },
        flare: { description: 'Three pale blue arrowheads nudging outwards (flare).', params: ['speed'] },
        'hello-world': { description: 'A dark disc with gold rings and spokes and a pulsing ring (TOP\'s Hello, World).', params: ['speed'] },
        'line-stack': { description: 'Two columns of arrows pointing at each other (line stack).', params: ['speed'] },
        proximity: { description: 'A yellow disc pulsing outwards inside a rotating dashed ring (proximity damage).', params: ['speed'] },
        'rotate-ccw': { description: 'A cyan ring with arrows orbiting counter-clockwise (rotation).', params: ['speed'] },
        'rotate-cw': { description: 'An amber ring with arrows orbiting clockwise (rotation).', params: ['speed'] },
        'spread-circle': { description: 'A pink circle with a rim pulsing outwards (spread).', params: ['speed'] },
        stack: { description: 'Four arrows pointing at the centre inside a turning ring (stack).', params: ['speed'] },
        tankbuster: { description: 'A thin ring inside three thick rotating arcs (tankbuster).', params: ['speed'] },
        'target-green': { description: 'A large green diamond bobbing above two orbiting smaller ones (target marker).', params: ['speed'] },
        tower: { description: 'Concentric solid and turning dashed rings with a pulsing rim (tower).', params: ['speed'] },
        'satin-plume': { description: 'A pale feather turning gently inside a dense, shifting purple glow (UWU\'s Satin Plume).', params: ['speed'] },
        'spiny-plume': { description: 'A pale feather turning gently inside a dense, shifting green glow, a little bigger than the Satin Plume\'s (UWU\'s Spiny Plume).', params: ['speed'] },
        unknown: { description: 'A grey disc with a question mark: a headmarker whose game icon no look is mapped to yet (`enums/headmarkers.yaml`).', params: [] }
    }
} as const satisfies Record<string, Record<string, LookDefinition>>;

/**
 * What the `.diagram` DDL uses each marker look as. The viewer draws them all as `marker` elements; the DDL keeps
 * "marker" for headmarkers. `hello-world` is in none of them: the DDL doesn't use it.
 */
export const DDL_MARKER_LOOKS = {
    /** Headmarkers (`+headmarker`, `headmarker:` on `define action`). Their size and look are fixed. */
    headmarkers: ['flare', 'line-stack', 'proximity', 'rotate-ccw', 'rotate-cw', 'spread-circle', 'stack', 'tankbuster', 'target-green', 'unknown'],
    /** Built-in drawings for `type: graphic`, such as an actor's look. */
    graphics: ['satin-plume', 'spiny-plume'],
    /** AoE looks (in `enums/omens.yaml`) drawn over the AoE's circle. */
    aoes: ['circle-kb', 'exaflare', 'tower']
} as const satisfies Record<string, readonly (keyof typeof LOOKS.markers)[]>;

/** An animation diagram elements can play when they appear (`enter`) or disappear (`exit`). */
export interface AnimationDefinition {
    readonly description: string;
    /** The element types the animation can be used on: all of them, only shapes ({@link SHAPE_TYPES}), or a list of element types. */
    readonly elements: 'all' | 'shapes' | readonly string[];
    /** The parameters the animation takes. */
    readonly params: readonly ParameterKey[];
}

/** The element types that `elements: 'shapes'` of an {@link AnimationDefinition} refers to. */
export const SHAPE_TYPES: readonly string[] = ['donut', 'ellipse', 'cone', 'rectangle'];

/** The animations elements can play when they appear (`enter`) and when they disappear (`exit`). */
export const ANIMATIONS = {
    enter: {
        none: { description: 'Appears at once.', elements: 'all', params: [] },
        fade: { description: 'Fades in (the default).', elements: 'all', params: ['speed'] },
        scale: { description: 'Grows from nothing around its origin.', elements: 'all', params: ['speed'] },
        'scale-x': { description: 'Grows along its x axis from nothing.', elements: 'all', params: ['speed'] },
        'scale-y': { description: 'Grows along its y axis from nothing.', elements: 'all', params: ['speed'] }
    },
    exit: {
        none: { description: 'Disappears at once.', elements: 'all', params: [] },
        fade: { description: 'Fades out (the default).', elements: 'all', params: ['speed'] },
        scale: { description: 'Shrinks to nothing around its origin.', elements: 'all', params: ['speed'] },
        'scale-x': { description: 'Shrinks along its x axis to nothing.', elements: 'all', params: ['speed'] },
        'scale-y': { description: 'Shrinks along its y axis to nothing.', elements: 'all', params: ['speed'] },
        rocks: { description: 'Rock spires erupt from the shape and sink again (earth attacks).', elements: 'shapes', params: ['speed', 'height', 'opacity'] },
        fire: { description: 'A flash, burning ground and a pillar of flame rising from the shape (fire attacks).', elements: 'shapes', params: ['speed', 'height', 'opacity'] },
        meteor: { description: 'A meteor falls diagonally onto the centre and leaves a burning crater; the omen stays until it hits.', elements: ['ellipse'], params: ['speed', 'opacity'] },
        'wave-cannon': { description: 'A blue beam shoots out from the line\'s start, with lightning along its edges.', elements: ['rectangle'], params: ['speed', 'opacity'] },
        'cosmo-arrow': { description: 'A band of light whose brightest part flows from the centre line to the edges.', elements: ['rectangle'], params: ['speed', 'opacity'] },
        'sync-bug': { description: 'A translucent black dome with black spikes shooting out of it (Critical Synchronization Bug).', elements: ['ellipse'], params: ['speed', 'opacity'] },
        'overflow-bug': { description: 'Black jagged lines scaling out from the centre inside a black border (Critical Overflow Bug).', elements: ['ellipse'], params: ['speed', 'opacity'] },
        flare: { description: 'Small yellow sparks flying out from the centre over a warm glow.', elements: ['ellipse'], params: ['speed', 'opacity'] },
        explosion: { description: 'A flash, a shockwave and a fireball that cools into rising smoke.', elements: 'shapes', params: ['speed', 'opacity'] },
        flash: { description: 'The area flashes bright yellow and slowly fades out (generic resolve).', elements: 'shapes', params: ['speed', 'color'] },
        blast: { description: 'A blast fired forward from the caster along the line, at full strength across its whole width (generic line resolve; yellow unless given a color).', elements: ['rectangle'], params: ['speed', 'opacity', 'color'] },
        sweep: { description: 'The flash travels over the omen like the pulse of look: aoe (from the centre, the inner edge, the top edge or the apex).', elements: 'shapes', params: ['speed', 'length', 'color'] },
        'feather-rain': { description: 'The omen turns green while sharp feathers rain straight down into the shape (Feather Rain).', elements: 'shapes', params: ['speed', 'opacity'] },
        wind: { description: 'Wind swirls over the area (generic wind resolve; use it for donuts).', elements: 'shapes', params: ['speed', 'opacity'] },
        tornado: { description: 'The wind plus a spinning tornado rising from the shape (circles).', elements: ['ellipse'], params: ['speed', 'height', 'opacity'] },
        vortex: { description: 'A layer of water spins inside the AoE like in a glass, climbing its edge (water resolve).', elements: ['ellipse'], params: ['speed', 'height', 'opacity'] },
        ice: { description: 'Thick spiral ridges of ice shoot up over the whole AoE and shatter (ice resolve).', elements: ['ellipse', 'donut'], params: ['speed', 'height', 'opacity'] },
        splash: { description: 'A big drop of water falls straight down onto the centre and splashes; the omen stays until it hits.', elements: ['ellipse'], params: ['speed', 'opacity'] },
        sound: { description: 'Broken arcs ripple out from an actor in quick succession, like sound in a comic (screams, roars).', elements: ['image', 'marker'], params: ['speed', 'opacity', 'color'] }
    }
} as const satisfies Record<'enter' | 'exit', Record<string, AnimationDefinition>>;
