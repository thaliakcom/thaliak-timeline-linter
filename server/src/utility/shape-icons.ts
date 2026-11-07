// Shape icons for the captions of cones and donuts, drawn from their `angle` and `inner` radius so that every
// size gets a fitting icon. They copy the style of the static icons in `www/images/shapes`.

const FILL = '#95654e';

/** The `edges` filter of `www/images/shapes/cone.svg`, under an ID of its own so that icons on one page don't clash. */
function edgesFilter(id: string): string {
    return `<filter id="${id}"><feFlood flood-color="#e6ac69"/><feComposite operator="out" in2="SourceGraphic" /><feMorphology operator="dilate" radius="0.1"/><feGaussianBlur stdDeviation="2" /><feComposite operator="atop" in2="SourceGraphic"/></filter>`;
}

/** Rounds a coordinate so that the markup stays short and identical icons stay identical. */
const round = (n: number) => Math.round(n * 100) / 100;

function svg(id: string, alt: string, shape: string, className: string): string {
    return `<svg class="${className}" viewBox="0 0 100 100" role="img" aria-label="${alt}" xmlns="http://www.w3.org/2000/svg"><defs>${edgesFilter(id)}</defs>${shape.replace('/>', ` fill="${FILL}" filter="url(#${id})" />`)}</svg>`;
}

/**
 * The icon of a cone of `angle` degrees. Up to 180°, its apex sits at the bottom centre and the sector fills the box,
 * as in `cone.svg`; exactly 180° is a half disc on the bottom edge. Wider cones are centred, opening upwards.
 */
export function coneIcon(angle: number, className: string = 'icon'): string {
    const half = angle / 2 * Math.PI / 180;
    let path: string;

    if (angle >= 360) {
        path = '<circle cx="50" cy="50" r="49" />';
    } else if (angle > 180) {
        const [r, cx, cy] = [49, 50, 50];
        const [x0, y0, x1] = [cx - r * Math.sin(half), cy - r * Math.cos(half), cx + r * Math.sin(half)];
        path = `<path d="M${cx},${cy} L${round(x0)},${round(y0)} A${r},${r},0,1,1,${round(x1)},${round(y0)} Z" />`;
    } else {
        // The largest radius whose sector fits the box: its width is 2r·sin(half) (or 2r past 90°), its height r.
        const r = Math.min(100, 50 / (half >= Math.PI / 2 ? 1 : Math.sin(half)));
        const [cx, cy] = [50, 100];
        const [x0, y0, x1] = [cx - r * Math.sin(half), cy - r * Math.cos(half), cx + r * Math.sin(half)];
        path = `<path d="M${cx},${cy} L${round(x0)},${round(y0)} A${round(r)},${round(r)},0,0,1,${round(x1)},${round(y0)} Z" />`;
    }

    return svg(`edges-cone-${round(angle)}`, `cone of ${angle}°`, path, className);
}

/** The icon of a donut whose inner radius is `inner` of its `outer` one: two circles, the inner one cut out. */
export function donutIcon(inner: number, outer: number, className: string = 'icon'): string {
    const ratio = Math.min(Math.max(inner / outer, 0), 1);
    const path = `<path fill-rule="evenodd" d="M1,50 A49,49,0,1,0,99,50 A49,49,0,1,0,1,50 Z M${round(50 - 49 * ratio)},50 A${round(49 * ratio)},${round(49 * ratio)},0,1,0,${round(50 + 49 * ratio)},50 A${round(49 * ratio)},${round(49 * ratio)},0,1,0,${round(50 - 49 * ratio)},50 Z" />`;

    return svg(`edges-donut-${round(ratio)}`, `donut, ${round(ratio * 100)}% hollow`, path, className);
}

/**
 * The generated icon of an action's shape with the class `className`: for a `cone` with an `angle` or a `dynamo`
 * with an `inner` radius. Undefined for every other action, which keeps its static icon from `mechanic-shapes.yaml`.
 */
export function generatedShapeIcon(action: { shape?: string, angle?: number, inner?: number, effectRange?: number }, className: string = 'icon'): string | undefined {
    if (action.shape === 'cone' && action.angle != null) return coneIcon(action.angle, className);
    if (action.shape === 'dynamo' && action.inner != null && (action.effectRange ?? 0) > 0) return donutIcon(action.inner, action.effectRange!, className);

    return undefined;
}

/** The size of an action's shape for its caption: `10y`, a cone's `10y 90°`, or a donut's `5–20y`. Empty without an `effectRange`. */
export function shapeSize(action: { shape?: string, angle?: number, inner?: number, effectRange?: number }): string {
    const range = action.effectRange ?? 0;

    if (range <= 0) return '';
    if (action.shape === 'dynamo' && action.inner != null) return `${action.inner}–${range}y`;
    if ((action.shape === 'cone' || action.shape === 'halfroom') && action.angle != null) return `${range}y ${action.angle}°`;

    return `${range}y`;
}
