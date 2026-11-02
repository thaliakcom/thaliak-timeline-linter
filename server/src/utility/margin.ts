import { Margin } from '../types/graphing';

/** A {@link Margin} expanded to `[top, right, bottom, left]`, like CSS `margin`. */
export function expandMargin(margin: Margin): [top: number, right: number, bottom: number, left: number] {
    if (typeof margin === 'number') {
        return [margin, margin, margin, margin];
    }

    const [top, right = top, bottom = top, left = right] = margin;
    return [top, right, bottom, left];
}
