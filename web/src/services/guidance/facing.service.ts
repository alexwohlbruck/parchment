// The traveller's facing for the frame being drawn, shared by the puck, the
// vehicle and the camera so they never disagree.

import { guidanceEngine } from './guidance-engine.service'
import { useOrientationService } from '@/services/orientation.service'
import { FacingFilter, type Facing } from '@/lib/guidance/facing'
import { segmentAt } from '@/lib/guidance/nav-route'
import { headingKnown } from '@/lib/guidance/vehicle-indicator'

const FRAME_SEC = 0.008
const filter = new FacingFilter()
let last: { t: number; facing: Facing | null } | null = null

export function sampleFacing(t = Date.now() / 1000): Facing | null {
  if (last && Math.abs(t - last.t) < FRAME_SEC) return last.facing
  const puck = guidanceEngine.sample(t)
  const route = guidanceEngine.route
  let facing: Facing | null = null
  if (puck && route) {
    const orientation = useOrientationService()
    facing = filter.update({
      routeBearing: headingKnown(puck) ? puck.bearing : null,
      speed: puck.speed,
      mode: segmentAt(route, puck.s)?.mode ?? 'driving',
      compass: {
        heading: orientation.heading.value,
        accuracy: orientation.headingAccuracy.value,
        tilt: orientation.tilt.value,
      },
    }, t)
  } else {
    filter.reset()
  }
  last = { t, facing }
  return facing
}
