/** Typings for the shared colour builder; see `building-color.mjs`. */
export declare const BUILDING_TINT: { light: number; dark: number }
export declare function buildingColor(
  amount: number,
  colorToken?: string,
  properties?: string[],
): unknown[]
