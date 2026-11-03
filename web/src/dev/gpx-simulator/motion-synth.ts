// Device motion to match the simulated trip: a phone barely jostled while the
// traveller stands, bouncing with each step on foot, shaken in a vehicle.

import type { Vec3 } from '@/lib/guidance/motion'
import { createRandom } from './fix-model'
import { simulatorStore } from './simulator-store'

const INTERVAL_MS = 50
const GRAVITY = 9.81
const MOVING_SPEED = 0.3
/** Faster than this is a vehicle, not a walk. */
const WALKING_TOP_SPEED = 3
const STRIDE = 0.7
const STEP_BOUNCE = 2.5
const MOVING_SHAKE = 0.6
const STANDING_SHAKE = 0.02

/** accelerationIncludingGravity at `t` seconds for a traveller moving at `speed` m/s. */
export function syntheticAcceleration(t: number, speed: number, random: () => number): Vec3 {
  const jitter = (shake: number) => shake * (2 * random() - 1)
  if (speed <= MOVING_SPEED) return { x: jitter(STANDING_SHAKE), y: jitter(STANDING_SHAKE), z: GRAVITY + jitter(STANDING_SHAKE) }
  if (speed > WALKING_TOP_SPEED) return { x: jitter(MOVING_SHAKE), y: jitter(MOVING_SHAKE), z: GRAVITY + jitter(MOVING_SHAKE) }
  const bounce = STEP_BOUNCE * Math.sin(2 * Math.PI * (speed / STRIDE) * t)
  return { x: jitter(0.3), y: jitter(0.3), z: GRAVITY + bounce + jitter(0.3) }
}

export function synthesizeMotion(): () => void {
  if (typeof DeviceMotionEvent === 'undefined') return () => {}
  const random = createRandom(7)
  const timer = setInterval(() => {
    const state = simulatorStore.getState()
    if (state.status !== 'playing') return
    const accelerationIncludingGravity = syntheticAcceleration(Date.now() / 1000, state.currentPoint?.speed ?? 0, random)
    window.dispatchEvent(
      new DeviceMotionEvent('devicemotion', {
        accelerationIncludingGravity,
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        interval: INTERVAL_MS,
      }),
    )
  }, INTERVAL_MS)
  return () => clearInterval(timer)
}
