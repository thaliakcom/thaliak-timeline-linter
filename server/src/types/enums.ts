export type MechanicType = 'unknown' | 'raidwide' | 'raidwide.lb' | 'raidwide.proximity' | 'raidwide.proximity.fake' | 'raidwide.sethp' | 'raidwide.percentual' | 'raidwide.transition' | 'raidwide.ultimate' | 'tb.tether' | 'tb.mt' | 'tb.ot' | 'tb.double' | 'tb.towers' | 'tb.stack' | 'tb.far' | 'tb.far.stack' | 'tb.close' | 'tb.close.stack' | 'tb.close-or-far' | 'tb.close-and-far' | 'tb.flare' | 'auto' | 'auto.single' | 'auto.double' | 'auto.stack' | 'auto.close' | 'auto.far' | 'stack.party' | 'stack.partner' | 'stack.enumeration' | 'stack.role' | 'stack.healers' | 'stack.supports' | 'stack' | 'stack.far' | 'stack.close' | 'stack.ululation' | 'stack.intercept' | 'stack.tower' | 'aoe' | 'aoe.delayed' | 'aoe.exaflares' | 'aoe.orbs' | 'aoe.rotating' | 'aoe.alternating' | 'aoe.expanding' | 'aoe.expanding.rings' | 'aoe.intercept' | 'aoe.chasing' | 'aoe.linger' | 'aoe.puddle' | 'aoe.memory' | 'aoe.condition' | 'aoe.aftershock' | 'aoe.facing' | 'aoe.knockback' | 'aoe.knockback.unavoidable' | 'aoe.3-to-1' | 'spread' | 'spread.close' | 'spread.far' | 'spread.role' | 'spread.tethers' | 'adds' | 'mech' | 'mech.phase' | 'mech.trio' | 'mech.check' | 'mech.status' | 'mech.statusoff' | 'mech.spread-or-stack' | 'mech.close-or-far' | 'mech.center-or-sides' | 'mech.store' | 'mech.lookaway' | 'mech.lookat' | 'mech.los' | 'mech.limit' | 'mech.failure' | 'mech.distance' | 'mech.tether.far' | 'mech.tether.close' | 'mech.tether.snappable' | 'mech.tether.distance' | 'mech.knockback' | 'mech.knockback.unavoidable' | 'mech.pull' | 'mech.pull.unavoidable' | 'mech.stillness' | 'mech.motion' | 'mech.arena' | 'mech.prepare' | 'mech.comet' | 'towers.single' | 'towers.double' | 'towers.triple' | 'towers.quadruple' | 'towers.random' | 'towers.kb' | 'enrage' | 'enrage.threshold' | 'enrage.soft' | 'hint' | 'hint.timed' | 'damage' | 'combination' | 'interruptible';
export type ShapeType = 'chariot' | 'defamation' | 'dynamo' | 'in-or-out' | 'cone' | '270°' | 'line' | 'grid' | 'plus' | 'cross' | 'sides' | 'rect' | 'halfroom' | 'star';
export type StatusType = 'dot' | 'vuln' | 'resistance' | 'condition' | 'delay' | 'form' | 'impairment' | 'impairment.pyretic' | 'indicator' | 'damage-up' | 'rot' | 'rot.pass' | 'rot.immunity';
export type DamageType = 'physical' | 'magic' | 'dark' | 'mixed';
export type LookType = 'plain' | 'aoe' | 'landslide' | 'sludge' | 'ripple' | 'cracks' | 'flame' | 'wormhole';
export type TetherLookType = 'plain' | 'glow' | 'flicker' | 'pulse' | 'strands' | 'braid' | 'coil' | 'chain' | 'jagged';
export type MarkerLookType = 'circle-kb' | 'exaflare' | 'flare' | 'hello-world' | 'line-stack' | 'proximity' | 'rotate-ccw' | 'rotate-cw' | 'spread-circle' | 'stack' | 'tankbuster' | 'target-green' | 'tower';
export type EnterAnimation = 'none' | 'fade' | 'scale' | 'scale-x' | 'scale-y';
export type ExitAnimation = 'none' | 'fade' | 'scale' | 'scale-x' | 'scale-y' | 'rocks' | 'fire' | 'meteor' | 'wave-cannon' | 'cosmo-arrow' | 'sync-bug' | 'overflow-bug' | 'flare' | 'explosion' | 'flash' | 'sweep' | 'feather-rain' | 'wind' | 'tornado' | 'vortex' | 'ice' | 'splash';
export type ParameterName = 'speed' | 'height' | 'color';
/** The look, as its name or as `{ type, ...parameters }` (see `enums/parameters.yaml`). */
export type LookTypeValue = LookType | {
    /** The look. */
    type: 'plain' | 'cracks';
    /** The colour it's drawn in, as an HTML color string. Replaces the look's own colour; with `plain`, the fill. */
    color?: string;
} | {
    /** The look. */
    type: 'aoe' | 'ripple' | 'flame';
    /**
     * How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).
     * @minimum 0.1
     * @maximum 10
     */
    speed?: number;
    /** The colour it's drawn in, as an HTML color string. Replaces the look's own colour; with `plain`, the fill. */
    color?: string;
} | {
    /** The look. */
    type: 'wormhole';
    /**
     * How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).
     * @minimum 0.1
     * @maximum 10
     */
    speed?: number;
};
/** The tether look, as its name or as `{ type, ...parameters }` (see `enums/parameters.yaml`). */
export type TetherLookTypeValue = TetherLookType | {
    /** The tether look. */
    type: 'plain' | 'glow' | 'chain';
    /** The colour it's drawn in, as an HTML color string. Replaces the look's own colour; with `plain`, the fill. */
    color?: string;
} | {
    /** The tether look. */
    type: 'flicker' | 'pulse' | 'strands' | 'braid' | 'coil';
    /**
     * How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).
     * @minimum 0.1
     * @maximum 10
     */
    speed?: number;
} | {
    /** The tether look. */
    type: 'jagged';
    /**
     * How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).
     * @minimum 0.1
     * @maximum 10
     */
    speed?: number;
    /** The colour it's drawn in, as an HTML color string. Replaces the look's own colour; with `plain`, the fill. */
    color?: string;
};
/** The marker, as its name or as `{ type, ...parameters }` (see `enums/parameters.yaml`). */
export type MarkerLookTypeValue = MarkerLookType | {
    /** The marker. */
    type: 'circle-kb' | 'exaflare' | 'flare' | 'hello-world' | 'line-stack' | 'proximity' | 'rotate-ccw' | 'rotate-cw' | 'spread-circle' | 'stack' | 'tankbuster' | 'target-green' | 'tower';
    /**
     * How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).
     * @minimum 0.1
     * @maximum 10
     */
    speed?: number;
};
/** The animation, as its name or as `{ type, ...parameters }` (see `enums/parameters.yaml`). */
export type EnterAnimationValue = EnterAnimation | {
    /** The animation. */
    type: 'fade' | 'scale' | 'scale-x' | 'scale-y';
    /**
     * How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).
     * @minimum 0.1
     * @maximum 10
     */
    speed?: number;
};
/** The animation, as its name or as `{ type, ...parameters }` (see `enums/parameters.yaml`). */
export type ExitAnimationValue = ExitAnimation | {
    /** The animation. */
    type: 'fade' | 'scale' | 'scale-x' | 'scale-y' | 'meteor' | 'wave-cannon' | 'cosmo-arrow' | 'sync-bug' | 'overflow-bug' | 'flare' | 'explosion' | 'flash' | 'sweep' | 'feather-rain' | 'wind' | 'splash';
    /**
     * How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).
     * @minimum 0.1
     * @maximum 10
     */
    speed?: number;
} | {
    /** The animation. */
    type: 'rocks' | 'fire' | 'tornado' | 'vortex' | 'ice';
    /**
     * How fast it plays, as a factor of its normal speed (2 is twice as fast, 0.5 half as fast).
     * @minimum 0.1
     * @maximum 10
     */
    speed?: number;
    /**
     * How high its raised parts rise, as a factor of their normal height (2 is twice as high).
     * @minimum 0.1
     * @maximum 5
     */
    height?: number;
};
