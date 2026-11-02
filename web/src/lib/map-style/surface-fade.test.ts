import { describe, expect, it } from 'vitest'
import { fadedPaint, scaleOpacity } from './surface-fade'

describe('scaleOpacity', () => {
  it('scales a constant, and an unset one from full', () => {
    expect(scaleOpacity(0.8, 0.5)).toBe(0.4)
    expect(scaleOpacity(undefined, 0.3)).toBe(0.3)
  })

  it('keeps a zoom curve outermost, scaling its outputs', () => {
    expect(scaleOpacity(['interpolate', ['linear'], ['zoom'], 14, 0, 16, 1], 0.5))
      .toEqual(['interpolate', ['linear'], ['zoom'], 14, 0, 16, 0.5])
    expect(scaleOpacity(['step', ['zoom'], 0, 15, ['case', ['has', 'x'], 1, 0]], 0.5))
      .toEqual(['step', ['zoom'], 0, 15, ['*', ['case', ['has', 'x'], 1, 0], 0.5]])
  })

  it('keeps a hidden layer hidden', () => {
    expect(scaleOpacity(0, 0.3)).toBe(0)
  })
})

describe('fadedPaint', () => {
  it('fades both of a symbol layer\'s parts', () => {
    expect(fadedPaint('symbol', () => undefined, 0.3)).toEqual({ 'icon-opacity': 0.3, 'text-opacity': 0.3 })
  })

  it('leaves a layer with no opacity alone', () => {
    expect(fadedPaint('background', () => 1, 0.3)).toEqual({})
  })
})
