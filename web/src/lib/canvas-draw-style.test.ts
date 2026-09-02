import { describe, it, expect } from 'vitest'
import {
  adoptStyle,
  drawStylePatch,
  hasStyleOption,
  TOOL_STYLE_OPTIONS,
} from './canvas-draw-style'
import { createAnnotation } from './canvas-annotations'
import type { CanvasAnnotation } from '@/types/canvas.types'

/**
 * One table decides what the tool options bar offers, what a new mark is
 * given, and what a finished mark's style editor shows — so what matters is
 * that it never hands a tool a setting it cannot draw, and never writes a
 * setting nobody chose.
 */

describe('what a tool can be styled with', () => {
  it('gives an area its fill and an outline none', () => {
    expect(hasStyleOption('polygon', 'fillOpacity')).toBe(true)
    expect(hasStyleOption('circle', 'fillColor')).toBe(true)
    expect(hasStyleOption('line', 'fillOpacity')).toBe(false)
    expect(hasStyleOption('doodle', 'fillColor')).toBe(false)
  })

  it('gives an open shape two ends to finish, and a ring none', () => {
    expect(hasStyleOption('line', 'strokeCap')).toBe(true)
    expect(hasStyleOption('doodle', 'strokeCap')).toBe(true)
    expect(hasStyleOption('route', 'strokeCap')).toBe(true)
    // A polygon's outline closes on itself, so it has no ends to style.
    expect(hasStyleOption('polygon', 'strokeCap')).toBe(false)
    expect(hasStyleOption('pin', 'strokeCap')).toBe(false)
  })

  it('gives a pin its glyph and shape, and no outline', () => {
    expect(hasStyleOption('pin', 'icon')).toBe(true)
    expect(hasStyleOption('pin', 'markerShape')).toBe(true)
    expect(hasStyleOption('pin', 'strokeWidth')).toBe(false)
  })

  it('offers a colour whatever is in hand', () => {
    for (const options of Object.values(TOOL_STYLE_OPTIONS)) {
      expect(options).toContain('color')
    }
  })
})

describe('the settings a new mark inherits', () => {
  it('keeps only what the tool can draw', () => {
    const patch = drawStylePatch('line', {
      color: 'teal',
      strokeWidth: 6,
      fillOpacity: 0.5,
      markerShape: 'square',
    })
    expect(patch).toEqual({ color: 'teal', strokeWidth: 6 })
  })

  it('keeps only what was actually set', () => {
    // A control showing its default must not write that default into a mark,
    // or every mark carries every field and nothing can ever be re-defaulted.
    expect(drawStylePatch('polygon', { color: 'teal' })).toEqual({
      color: 'teal',
    })
  })

  it('reaches the mark the tool draws', () => {
    const drawn = createAnnotation('polygon', [[0, 0], [1, 0], [1, 1]], {
      color: 'jade',
      strokeWidth: 5,
      fillOpacity: 0.4,
      markerSize: 12,
    })
    expect(drawn).toMatchObject({ color: 'jade', strokeWidth: 5, fillOpacity: 0.4 })
    // Not a pin, so it never had a marker size.
    expect(drawn.markerSize).toBeUndefined()
  })

  it('falls back to the default colour when nothing is set', () => {
    expect(createAnnotation('line', [[0, 0], [1, 1]]).color).toBe('compass')
  })
})

describe('taking a mark style onto the toolbar', () => {
  const pin = {
    id: 'a1',
    tool: 'pin',
    positions: [[0, 0]],
    color: 'ruby',
    icon: 'Train',
    markerShape: 'square',
    markerSize: 12,
    // A pin cannot draw this; whatever put it here, it must not travel.
    fillOpacity: 0.3,
  } as unknown as CanvasAnnotation

  it('copies the style to the tool that drew it, and no other', () => {
    const styles = adoptStyle({ line: { color: 'teal' } }, pin)
    expect(styles.pin).toEqual({
      color: 'ruby',
      icon: 'Train',
      markerShape: 'square',
      markerSize: 12,
    })
    expect(styles.line).toEqual({ color: 'teal' })
  })

  it('replaces rather than merges, so the bar reads as the mark you picked', () => {
    const styles = adoptStyle(
      { pin: { color: 'teal', markerSize: 20, icon: 'Anchor' } },
      { id: 'a2', tool: 'pin', positions: [[0, 0]], color: 'jade' } as CanvasAnnotation,
    )
    // The plain pin has no size or glyph of its own, so neither does the bar.
    expect(styles.pin).toEqual({ color: 'jade' })
  })
})
