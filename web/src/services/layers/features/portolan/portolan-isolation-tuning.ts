/**
 * How far the surrounding network is knocked back while one route is isolated.
 *
 * The portolan renderer and the legacy overlay dim the same pixels from two
 * call sites, so the value lives here rather than being tuned twice.
 */
export const NETWORK_DIM_LIGHT = 0.25
export const NETWORK_DIM_DARK = 0.42

export const networkDim = (isDark: boolean) =>
  isDark ? NETWORK_DIM_DARK : NETWORK_DIM_LIGHT
