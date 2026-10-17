/** Typings for the shared colour builder; see `building-color.mjs`. */
export declare const BUILDING_TINT: { light: number; dark: number }
export declare function buildingColor(
  amount: number,
  colorToken?: string,
  properties?: string[],
): unknown[]
type Hsl = [number, number, number]
export declare const BUILDING_MATERIALS: Record<string, Hsl>
export declare const ROOF_MATERIALS: Record<string, Hsl>
export declare const BUILDING_MIX: Record<'house' | 'low' | 'mid' | 'tall' | 'industrial', Record<string, number>>
export declare function materialColor(name: string): string
export declare function buildingMaterialColor(roof?: boolean): unknown[]
