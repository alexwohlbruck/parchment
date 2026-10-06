/** Typings for the shared colour builder; see `building-color.mjs`. */
export declare const BUILDING_TINT: { light: number; dark: number }
export declare const BUILDING_PASTELS: { light: string[]; dark: string[] }
export declare function buildingColor(
  amount: number,
  colorToken?: string,
  properties?: string[],
  fallback?: unknown,
): unknown[]
export declare function unpaintedBuildingColor(
  flavor: 'light' | 'dark',
  colorToken?: string,
): unknown
