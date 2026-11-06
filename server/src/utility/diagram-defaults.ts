// Default element looks that both the viewer and the `.diagram` compiler need. Free of the DOM, so that the compiler can run at build time.

/** The size of a boss icon in plane units, where nothing gives it one. */
const BOSS_SIZE = 70;

/** The icon of bosses and timeline actors. */
export const BOSS_IMAGE = '/images/boss.svg';

/** How a boss looks: in step diagrams, the `boss` element; in `.diagram` files, a timeline actor without `define element`. */
export const DEFAULT_ACTOR_GRAPHICS = {
    type: 'image' as const,
    size: BOSS_SIZE,
    opacity: 0.7,
    rotate: 180,
    origin: [0.5, 0.5] as [number, number],
    'coordinate-system': 'polar' as const,
    image: BOSS_IMAGE,
    extrude: '1.5 #000000BB',
    lookAtOffset: 180
};
