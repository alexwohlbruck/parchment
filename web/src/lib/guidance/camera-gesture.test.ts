import { describe, expect, test } from 'vitest'
import { isUserGesture, stateAfterGesture } from './camera-gesture'

describe('camera gestures', () => {
  test('only moves caused by a DOM event are the user', () => {
    expect(isUserGesture({ originalEvent: new Event('pointermove') })).toBe(true)
    expect(isUserGesture({})).toBe(false)
    expect(isUserGesture({ originalEvent: undefined })).toBe(false)
  })

  test('a gesture while following drops into free browsing', () => {
    expect(stateAfterGesture('following')).toBe('free')
    expect(stateAfterGesture('free')).toBe('free')
    expect(stateAfterGesture('overview')).toBe('overview')
  })
})
