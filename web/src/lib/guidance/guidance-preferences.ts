import type { BearingMode, CameraMode } from '@/lib/guidance/camera-framing'
import type { SpeedDisplay } from '@/lib/guidance/speed-display'
import { DEFAULT_VEHICLE_PREFERENCES, type VehiclePreferences } from '@/lib/guidance/vehicle-indicator'

export type SoundMode = 'all' | 'alerts' | 'silent'
export const SOUND_MODES: SoundMode[] = ['all', 'alerts', 'silent']

export interface GuidancePreferences {
  cameraMode: CameraMode
  bearingMode: BearingMode
  /** Per travel mode: walkers mostly want quiet, drivers want every turn. */
  sound: Record<string, SoundMode>
  autoSwitchDocks: boolean
  vehicle: VehiclePreferences
  speedDisplay: SpeedDisplay
  adaptiveSpeech: boolean
}

export const DEFAULT_GUIDANCE_PREFERENCES: GuidancePreferences = {
  cameraMode: 'follow-3d',
  bearingMode: 'look-ahead',
  sound: { driving: 'all', cycling: 'all', walking: 'alerts' },
  autoSwitchDocks: true,
  vehicle: DEFAULT_VEHICLE_PREFERENCES,
  speedDisplay: 'both',
  adaptiveSpeech: true,
}
