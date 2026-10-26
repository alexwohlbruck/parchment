import { describe, expect, it } from 'vitest'
import { laneStrokes } from './lane-glyph'

describe('laneStrokes', () => {
  it('lights only the arrow a turn uses, drawn over the others', () => {
    const strokes = laneStrokes({ arrows: ['left', 'through'], valid: true, recommended: true }, 'left')
    expect(strokes.map(s => [s.arrow, s.lit])).toEqual([
      ['through', false],
      ['left', true],
    ])
  })

  it('mirrors left arrows from the right-hand drawings', () => {
    const [left] = laneStrokes({ arrows: ['left'], valid: true, recommended: false }, 'left')
    const [right] = laneStrokes({ arrows: ['right'], valid: true, recommended: false }, 'right')
    expect(left).toMatchObject({ mirrored: true, d: right.d })
    expect(right.mirrored).toBe(false)
  })

  it('leaves a lane that does not lead on to the maneuver unlit', () => {
    expect(laneStrokes({ arrows: ['through', 'right'], valid: false, recommended: false }, 'left').some(s => s.lit)).toBe(false)
  })

  it('lights a valid lane whole when none of its arrows names the maneuver', () => {
    expect(laneStrokes({ arrows: ['through'], valid: true, recommended: false }, 'arrive').every(s => s.lit)).toBe(true)
  })
})
