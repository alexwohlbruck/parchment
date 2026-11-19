/** Battery saver level: `normal` trims the map's extras, `extreme` keeps only what's needed to get there. */
export type PowerSaver = 'off' | 'normal' | 'extreme'

/** Switches battery saver on by itself once the battery runs down. Levels are 0–1. */
export interface PowerSaverAuto {
  enabled: boolean
  normalAt: number
  extremeAt: number
}
