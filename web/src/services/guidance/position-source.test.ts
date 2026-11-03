import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/api', () => ({ isTauri: false }))

import { startPositionSource } from './position-source'

function motionEvent(accelerationIncludingGravity: object | null) {
  return Object.assign(new Event('devicemotion'), {
    accelerationIncludingGravity,
    rotationRate: { alpha: 30, beta: 10, gamma: 20 },
  })
}

describe('startPositionSource motion', () => {
  const geolocation = { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() }
  Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true })

  afterEach(() => vi.clearAllMocks())

  test('hands the engine accelerometer and gyro readings in device axes', () => {
    const onMotion = vi.fn()
    const source = startPositionSource({ onFix: () => {}, onMotion }, 1000)
    window.dispatchEvent(motionEvent({ x: 0.1, y: -0.2, z: 9.8 }))
    source.stop()
    expect(onMotion).toHaveBeenCalledOnce()
    expect(onMotion.mock.calls[0][0]).toMatchObject({
      accelWithGravity: { x: 0.1, y: -0.2, z: 9.8 },
      rotationRate: { x: 10, y: 20, z: 30 },
    })
  })

  test('skips readings without an accelerometer and stops listening with its owner', () => {
    const onMotion = vi.fn()
    const source = startPositionSource({ onFix: () => {}, onMotion }, 1000)
    window.dispatchEvent(motionEvent(null))
    source.stop()
    window.dispatchEvent(motionEvent({ x: 0, y: 0, z: 9.8 }))
    expect(onMotion).not.toHaveBeenCalled()
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1)
  })
})
