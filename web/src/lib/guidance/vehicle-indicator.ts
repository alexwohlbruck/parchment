// Which puck each travel mode draws during navigation, and how big it is drawn.

export type VehicleModel = 'hatchback' | 'suv' | 'pickup' | 'bike'
export type VehicleIndicator = 'arrow' | VehicleModel
export type PuckMode = 'walking' | 'cycling' | 'driving'

export interface VehicleChoice {
  indicator: VehicleIndicator
  color: string
}

export type VehiclePreferences = Record<PuckMode, VehicleChoice>

export const PUCK_MODES: PuckMode[] = ['driving', 'cycling', 'walking']

export const INDICATORS: Record<PuckMode, VehicleIndicator[]> = {
  driving: ['arrow', 'hatchback', 'suv', 'pickup'],
  cycling: ['arrow', 'bike'],
  walking: ['arrow'],
}

export const VEHICLE_COLORS = [
  '#007aff',
  '#e5383b',
  '#f28c28',
  '#f2c230',
  '#2fa84f',
  '#7b5cd6',
  '#f2f2f2',
  '#3a3d42',
] as const

export const DEFAULT_VEHICLE_COLOR = VEHICLE_COLORS[0]

export const DEFAULT_VEHICLE_PREFERENCES: VehiclePreferences = {
  driving: { indicator: 'arrow', color: DEFAULT_VEHICLE_COLOR },
  cycling: { indicator: 'arrow', color: DEFAULT_VEHICLE_COLOR },
  walking: { indicator: 'arrow', color: DEFAULT_VEHICLE_COLOR },
}

export function puckMode(travelMode: string): PuckMode {
  if (travelMode === 'driving' || travelMode === 'motorcycle' || travelMode === 'truck') return 'driving'
  if (travelMode === 'cycling' || travelMode === 'biking') return 'cycling'
  return 'walking'
}

/** The stored choice for a mode, falling back to the arrow for anything that mode does not offer. */
export function vehicleChoice(preferences: Partial<VehiclePreferences> | undefined, travelMode: string): VehicleChoice {
  const mode = puckMode(travelMode)
  const stored = preferences?.[mode]
  const indicator = stored && INDICATORS[mode].includes(stored.indicator) ? stored.indicator : 'arrow'
  const color = stored && /^#[0-9a-f]{6}$/i.test(stored.color) ? stored.color : DEFAULT_VEHICLE_COLOR
  return { indicator, color }
}

/** Below this speed an unsnapped puck's heading is a guess, so the arrow gives way to a dot. */
const HEADING_MIN_SPEED = 1

export function headingKnown(puck: { snapped: boolean; speed: number }): boolean {
  return puck.snapped || puck.speed >= HEADING_MIN_SPEED
}

/** Glyph colour that stays legible on a disc of `hex`. */
export function inkOn(hex: string): string {
  const [r, g, b] = hexToLinear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#1c1c1e' : '#ffffff'
}

/** sRGB hex to linear RGB, 0–1. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)]
}

const EARTH_CIRCUMFERENCE = 40075016.686
/** On-screen length a model aims for, in CSS pixels. */
const TARGET_PIXELS: Record<VehicleModel, number> = { hatchback: 50, suv: 54, pickup: 58, bike: 40 }
/** The most a model is enlarged past life size, so zoomed-out views do not draw a city block of car. */
const MAX_EXAGGERATION = 10

/**
 * How many times life size to draw a model of `length` metres: a steady size
 * on screen, never smaller than life and never past the cap.
 */
export function vehicleScale(model: VehicleModel, length: number, zoom: number, lat: number): number {
  const metresPerPixel = (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
  const wanted = (TARGET_PIXELS[model] * metresPerPixel) / length
  return Math.min(MAX_EXAGGERATION, Math.max(1, wanted))
}
