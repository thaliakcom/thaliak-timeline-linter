// Sizing rules that turn game data into diagram sizes. Shared by the build (src/eleventy) and the diagram
// editor, which loads them through src/diagram-viewer.ts, so this module must stay free of Node imports.
import type { ElementDefinition, Graphing, ImageDefinition, ImageDelta, PositivePoint, ProcessedSizing } from '../types/graphing';
import type { Action as ApiAction, BNpcBase, ModelSkeleton } from '../types/ironworks';

/** The hitbox radius in yalms of players, and of enemies whose model has no radius in game data. */
export const DEFAULT_HITBOX_RADIUS = 0.5;

/**
 * The cast types in `CAST_TYPES` (`eleventy/utility/data.ts`) with padding, i.e. whose `effectRange` is measured from
 * the edge of the caster's hitbox rather than its centre or the target.
 */
export const PADDED_CAST_TYPES = [3, 4, 5];

/**
 * The ModelSkeleton row whose radius applies to the BNpcBase if its ModelChara has no radius:
 * monster models directly, demihuman models after the monster skeletons; undefined for other models.
 */
export function hitboxSkeletonId(bnpcBase: BNpcBase): number | undefined {
    return bnpcBase.modelCharaType === 3 ? bnpcBase.modelCharaModel
        : bnpcBase.modelCharaType === 2 ? 10000 + bnpcBase.modelCharaModel
        : undefined;
}

/**
 * The hitbox radius in yalms of the BNpcBase: its ModelChara's radius or, if that is 0, the radius of
 * `skeleton` (the row {@link hitboxSkeletonId} names) or else {@link DEFAULT_HITBOX_RADIUS}, times the
 * BNpcBase's scale.
 */
export function hitboxRadius(bnpcBase: BNpcBase, skeleton: ModelSkeleton | undefined): number {
    let radius = bnpcBase.modelCharaRadius;

    if (radius === 0) {
        radius = hitboxSkeletonId(bnpcBase) != null ? skeleton!.radius : DEFAULT_HITBOX_RADIUS;
    }

    return radius * bnpcBase.scale;
}

/**
 * The action's `effectRange` plus `hitboxRadius` (the caster's) for {@link PADDED_CAST_TYPES},
 * rounded so that floating point errors don't show up in captions (e.g. 8.700000000000001y).
 */
export function paddedEffectRange(action: Pick<ApiAction, 'effectRange' | 'castType'>, hitboxRadius: number = DEFAULT_HITBOX_RADIUS): number {
    const padding = action.effectRange > 0 && PADDED_CAST_TYPES.includes(action.castType) ? hitboxRadius : 0;
    return Math.round((action.effectRange + padding) * 1000) / 1000;
}

/**
 * The size in yalms of an element of the given type that is sized by an action with `effectRange`
 * (see {@link paddedEffectRange}) and `xAxisModifier` (the width of rectangular AoEs). Undefined if the
 * action can't size it: no range, a donut (game data has no inner radius) or a rectangle without width.
 */
export function actionYalms(type: ElementDefinition['type'], effectRange: number, xAxisModifier: number | undefined): PositivePoint | undefined {
    if (effectRange <= 0 || type === 'donut' || (type === 'rectangle' && (xAxisModifier ?? 0) <= 0)) {
        return undefined;
    }

    return type === 'ellipse' ? [effectRange * 2, effectRange * 2]
        : type === 'cone' ? [0, effectRange]
        : [xAxisModifier!, effectRange];
}

/**
 * Plane units per yalm on each axis: the part of an arena image inside its margin, as drawn (fit into
 * the arena's `box`, like `fitSprite` in `ElementRenderer.ts`), divided by the fight's arena size.
 */
export function planeUnitsPerYalm(imageSize: readonly [number, number], margin: readonly [top: number, right: number, bottom: number, left: number], box: readonly [number, number], scale: readonly [number, number], arenaSize: readonly [number, number]): [number, number] {
    const [width, height] = imageSize;
    const [top, right, bottom, left] = margin;
    const fit = Math.min(box[0] / width, box[1] / height);

    return [(width - left - right) * fit * scale[0] / arenaSize[0], (height - top - bottom) * fit * scale[1] / arenaSize[1]];
}

/** The arena data whose `image` needs an `imageSize`: the `arena` element and every step's `arena` object. */
export function arenaImageData(graphing: Graphing): (Partial<ImageDefinition | ImageDelta> & ProcessedSizing)[] {
    const arenas: (Partial<ImageDefinition | ImageDelta> & ProcessedSizing)[] = [];

    if (graphing.elements.arena != null) {
        arenas.push(graphing.elements.arena as ImageDefinition);
    }

    for (const steps of Object.values(graphing.graphs)) {
        for (const step of steps) {
            if (step.arena != null && typeof step.arena === 'object' && !Array.isArray(step.arena)) {
                arenas.push(step.arena as ImageDelta);
            }
        }
    }

    return arenas;
}
