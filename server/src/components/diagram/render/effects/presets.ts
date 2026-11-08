import { ExitAnimation } from '../../../../types/enums';

/** The `exit` animations that replace the element with a resolve effect (see `ResolveEffects`). */
export const RESOLVE_PRESETS = [
    'rocks', 'fire', 'meteor', 'explosion', 'wave-cannon', 'cosmo-arrow', 'sync-bug', 'overflow-bug', 'flare',
    'flash', 'blast', 'sweep', 'feather-rain', 'wind', 'tornado', 'vortex', 'ice', 'splash'
] as const;
export type ResolvePreset = typeof RESOLVE_PRESETS[number];

export function isResolvePreset(animation: ExitAnimation): animation is ResolvePreset {
    return (RESOLVE_PRESETS as readonly string[]).includes(animation);
}

/** The presets without a raised part (see `raisedFragment`), which get no raised mesh. */
export const GROUND_ONLY: ReadonlySet<ResolvePreset> = new Set(['flash', 'blast', 'sweep', 'wind']);

/** The presets without a ground part (see `groundFragment`), which get no ground mesh. */
export const RAISED_ONLY: ReadonlySet<ResolvePreset> = new Set(['overflow-bug']);

/** How long each resolve preset plays, in ms. */
export const PRESET_DURATIONS: Record<ResolvePreset, number> = {
    rocks: 1200, fire: 1400, meteor: 2000, explosion: 1600,
    'wave-cannon': 1200, 'cosmo-arrow': 1200, 'sync-bug': 1200, 'overflow-bug': 1200, flare: 1000,
    flash: 800, blast: 900, sweep: 650, 'feather-rain': 1600, wind: 1600, tornado: 1600, vortex: 1600, ice: 1600, splash: 1800
};

/** The progress at which static viewers show a resolve preset as a still frame (its peak). */
export const PRESET_STATIC_PROGRESS: Record<ResolvePreset, number> = {
    rocks: 0.35, fire: 0.35, meteor: 0.45, explosion: 0.2,
    'wave-cannon': 0.4, 'cosmo-arrow': 0.3, 'sync-bug': 0.4, 'overflow-bug': 0.6, flare: 0.35,
    flash: 0.1, blast: 0.35, sweep: 0.35, 'feather-rain': 0.5, wind: 0.3, tornado: 0.35, vortex: 0.4, ice: 0.45, splash: 0.45
};

/** The progress of `meteor` and `splash` at which the meteor or the drop hits. */
export const IMPACT = 0.3 as const;

/** The progress of `blast` at which its front reaches the far end of the line. */
export const BLAST_REACH = 0.35 as const;

/**
 * The presets whose disappearing element stays visible under the effect at first (see `Transition`):
 * until the progress `until`, then it fades out over `fade` ms.
 * - `meteor`, `splash`: the element is the target until the meteor or the drop hits.
 * - `sweep`: the sweep is an overlay; the element stays until the front reaches the far edge.
 * - `feather-rain`: the element crossfades into the rain's ground (which fades in over the same 15 %).
 * - `flash`: the element stays under the flash until it peaks.
 * - `blast`: the element stays under the blast until its front reaches the far end.
 */
export const OMEN_HOLDS: Partial<Record<ResolvePreset, { until: number, fade: number }>> = {
    flash: { until: 0.1, fade: 100 },
    blast: { until: BLAST_REACH, fade: 150 },
    meteor: { until: IMPACT, fade: 100 },
    splash: { until: IMPACT, fade: 100 },
    sweep: { until: 0.5, fade: 0.3 * 650 },
    'feather-rain': { until: 0, fade: 0.15 * 1600 }
};
