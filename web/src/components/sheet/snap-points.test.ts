import { describe, test, expect } from 'vitest'
import {
  addPixels,
  adjustForSafeArea,
  clampPeek,
  resolveSnapPoints,
  snapPointToPixels,
} from '@/components/sheet/snap-points'

const VH = 800

describe('snapPointToPixels', () => {
  test('reads a pixel string, a viewport fraction and a raw pixel count', () => {
    expect(snapPointToPixels('125px', VH)).toBe(125)
    expect(snapPointToPixels(0.5, VH)).toBe(400)
    expect(snapPointToPixels(240, VH)).toBe(240)
  })

  test('treats 1 as full height rather than one pixel', () => {
    expect(snapPointToPixels(1, VH)).toBe(VH)
  })
})

describe('addPixels', () => {
  test('preserves the format it was given', () => {
    expect(addPixels('125px', 20, VH)).toBe('145px')
    expect(addPixels(0.5, 80, VH)).toBeCloseTo(0.6, 5)
    expect(addPixels(240, 20, VH)).toBe(260)
  })

  test('leaves non-pixel strings alone', () => {
    expect(addPixels('50%', 20, VH)).toBe('50%')
  })

  test('is a no-op for a non-positive delta', () => {
    expect(addPixels('125px', 0, VH)).toBe('125px')
  })
})

describe('clampPeek', () => {
  test('keeps the peek below the next detent', () => {
    // 0.5 of 800 is 400; the peek may reach 376.
    expect(clampPeek('500px', 0.5, VH)).toBe('376px')
  })

  test('leaves a peek that already fits', () => {
    expect(clampPeek('125px', 0.5, VH)).toBe('125px')
  })

  test('does nothing without a next detent', () => {
    expect(clampPeek('500px', undefined, VH)).toBe('500px')
  })

  test('ignores fractional peeks, which cannot overshoot this way', () => {
    expect(clampPeek(0.9, 0.5, VH)).toBe(0.9)
  })
})

describe('adjustForSafeArea', () => {
  test('pulls full height down below the notch', () => {
    expect(adjustForSafeArea(1, 2, { top: 40, bottom: 0 }, VH)).toBeCloseTo(0.95, 5)
  })

  test('grows the peek by the home indicator', () => {
    expect(adjustForSafeArea('125px', 0, { top: 0, bottom: 30 }, VH)).toBe('155px')
  })

  test('leaves middle detents untouched', () => {
    expect(adjustForSafeArea(0.5, 1, { top: 40, bottom: 30 }, VH)).toBe(0.5)
  })
})

describe('resolveSnapPoints', () => {
  test('keeps the authored points when nothing is measured', () => {
    expect(
      resolveSnapPoints({ base: ['125px', 0.5, 1], viewportHeight: VH }),
    ).toEqual(['125px', 0.5, 1])
  })

  test('swaps a measured peek into the first slot', () => {
    expect(
      resolveSnapPoints({
        base: ['125px', 0.5, 1],
        measuredPeekPx: 200,
        viewportHeight: VH,
      }),
    ).toEqual(['200px', 0.5, 1])
  })

  test('clamps a measured peek that would overshoot the next detent', () => {
    expect(
      resolveSnapPoints({
        base: ['125px', 0.5, 1],
        measuredPeekPx: 900,
        viewportHeight: VH,
      })[0],
    ).toBe('376px')
  })

  test('stays ascending, which vaul drag maths assumes', () => {
    const points = resolveSnapPoints({
      base: ['125px', 0.5, 1],
      measuredPeekPx: 900,
      viewportHeight: VH,
      insets: { top: 40, bottom: 30 },
    })
    const px = points.map(p => snapPointToPixels(p, VH))
    expect(px).toEqual([...px].sort((a, b) => a - b))
  })

  test('handles an empty list', () => {
    expect(resolveSnapPoints({ base: [], viewportHeight: VH })).toEqual([])
  })
})
