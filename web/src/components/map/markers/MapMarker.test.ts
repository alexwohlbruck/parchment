import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MapMarker from './MapMarker.vue'
import {
  markerCss,
  markerPaint,
  MARKER_LIVE_PLATE_SIZE,
  MARKER_PLATE_SIZE,
} from '@/lib/map-marker'

/**
 * The point of this component is that a Vue marker stops being a second opinion
 * about what a marker is — so what is worth pinning down is that it draws what
 * `markerCss` says, at whatever size it is asked for, and that the states a
 * live marker takes actually change something.
 */

const paint = markerPaint('#3b82f6', 'disc', false)

const mountMarker = (props: Record<string, unknown> = {}) =>
  mount(MapMarker, { props: { paint, ...props } })

const plate = (w: ReturnType<typeof mountMarker>) =>
  w.find('[style*="border-radius"]')

describe('the plate', () => {
  it('is drawn at the size `markerCss` gives it, ring included', () => {
    const css = markerCss(paint, 'disc', MARKER_PLATE_SIZE)
    expect(plate(mountMarker()).attributes('style')).toContain(
      `width: ${css.plate.width}`,
    )
  })

  it('takes the size it is asked for, so a live marker can be bigger', () => {
    const live = markerCss(paint, 'disc', MARKER_LIVE_PLATE_SIZE)
    const w = mountMarker({ size: MARKER_LIVE_PLATE_SIZE })
    expect(plate(w).attributes('style')).toContain(`width: ${live.plate.width}`)
    expect(live.plate.width).not.toBe(
      markerCss(paint, 'disc', MARKER_PLATE_SIZE).plate.width,
    )
  })

  it('squares off when asked, rather than rounding to a disc', () => {
    const w = mountMarker({ shape: 'square' })
    expect(plate(w).attributes('style')).not.toContain('9999px')
  })
})

describe('what sits on the plate', () => {
  it('holds a glyph at its share of the plate', () => {
    const w = mountMarker({ size: MARKER_LIVE_PLATE_SIZE })
    const glyph = markerCss(paint, 'disc', MARKER_LIVE_PLATE_SIZE).glyph
    expect(w.html()).toContain(`width: ${glyph.width}`)
  })

  it('lets a face span the whole plate instead', () => {
    // A friend's avatar is the mark, not a glyph on it — it has to fill the
    // plate and be clipped by it rather than sit at the glyph ratio.
    const w = mountMarker({ fill: true, size: MARKER_LIVE_PLATE_SIZE })
    expect(w.html()).toContain('overflow: hidden')
    expect(w.html()).not.toContain(
      `width: ${markerCss(paint, 'disc', MARKER_LIVE_PLATE_SIZE).glyph.width}`,
    )
  })
})

describe('live states', () => {
  it('pulses only while the position is worth believing', () => {
    expect(mountMarker({ pulse: true }).find('.map-marker-pulse').exists()).toBe(
      true,
    )
    // Muted means the last report is old — a pulse would claim it is current.
    expect(
      mountMarker({ pulse: true, muted: true }).find('.map-marker-pulse').exists(),
    ).toBe(false)
  })

  it('dims when muted', () => {
    expect(mountMarker({ muted: true }).classes()).toContain('opacity-80')
  })
})
