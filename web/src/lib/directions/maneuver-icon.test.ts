import { describe, expect, it } from 'vitest'
import { maneuverIcon } from './maneuver-icon'

describe('maneuverIcon', () => {
  it('draws a fork with the way not taken behind it, mirrored for the left', () => {
    const right = maneuverIcon('keep-right')
    expect(right.faint).toBeTruthy()
    expect(maneuverIcon('keep-left')).toEqual({ ...right, mirrored: true })
  })

  it('draws a plain turn without a faint branch', () => {
    expect(maneuverIcon('slight-right').faint).toBeUndefined()
  })
})
