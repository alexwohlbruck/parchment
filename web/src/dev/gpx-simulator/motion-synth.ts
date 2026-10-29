// Device motion to match the simulated trip: a phone barely jostled while the
// vehicle stands, shaken while it moves.

import { createRandom } from './fix-model'
import { simulatorStore } from './simulator-store'

const INTERVAL_MS = 50
const GRAVITY = 9.81
const MOVING_SPEED = 0.3
const MOVING_SHAKE = 0.6
const STANDING_SHAKE = 0.02

export function synthesizeMotion(): () => void {
  if (typeof DeviceMotionEvent === 'undefined') return () => {}
  const random = createRandom(7)
  const timer = setInterval(() => {
    const state = simulatorStore.getState()
    if (state.status !== 'playing') return
    const shake = (state.currentPoint?.speed ?? 0) > MOVING_SPEED ? MOVING_SHAKE : STANDING_SHAKE
    const jitter = () => shake * (2 * random() - 1)
    window.dispatchEvent(
      new DeviceMotionEvent('devicemotion', {
        accelerationIncludingGravity: { x: jitter(), y: jitter(), z: GRAVITY + jitter() },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        interval: INTERVAL_MS,
      }),
    )
  }, INTERVAL_MS)
  return () => clearInterval(timer)
}
