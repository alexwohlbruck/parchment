/** Typings for the shared colour builder; see `building-color.mjs`. */
export declare const BUILDING_TINT: { light: number; dark: number }
export declare function buildingColor(
  amount: number,
  colorToken?: string,
  properties?: string[],
): unknown[]
type Hsl = [number, number, number]
export declare const BUILDING_PALETTE: {
  hues: Record<string, Hsl>
  low: string[]
  mid: string[]
  tall: string[]
}
export declare function paletteColor(name: string): string
export declare function paletteBuildingColor(roof?: boolean): unknown[]
