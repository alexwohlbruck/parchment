import type { PowerSaver } from '@/types/power.types'
import type { CameraMode } from './camera-framing'

export interface NavPowerBudget {
  /** Shortest interval between drawn frames; 0 leaves it to the display. */
  minFrameMs: number
  /** Tilted camera and 3D vehicle models. */
  allow3d: boolean
}

const BUDGETS: Record<PowerSaver, NavPowerBudget> = {
  off: { minFrameMs: 0, allow3d: true },
  normal: { minFrameMs: 33, allow3d: true },
  extreme: { minFrameMs: 66, allow3d: false },
}

export function navPowerBudget(saver: PowerSaver): NavPowerBudget {
  return BUDGETS[saver]
}

export function navCameraMode(mode: CameraMode, budget: NavPowerBudget): CameraMode {
  return mode === 'follow-3d' && !budget.allow3d ? 'heading-up' : mode
}
