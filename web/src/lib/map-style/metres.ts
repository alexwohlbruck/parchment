/** Pixels per metre at a zoom, at 36°N: exact enough for paint across the US. */
export const pxPerMetre = (z: number) => 2 ** z / 63330

/** A zoom ramp drawing `m` metres, a number or an expression, at true size from `from` up. */
export function metres(m: number | unknown[], { from = 16, minimum = 0 } = {}): any {
  const at = (z: number) =>
    typeof m === 'number' ? Math.max(minimum, m * pxPerMetre(z)) : ['max', minimum, ['*', m, pxPerMetre(z)]]
  return ['interpolate', ['exponential', 2], ['zoom'], from, at(from), 22, at(22)]
}
