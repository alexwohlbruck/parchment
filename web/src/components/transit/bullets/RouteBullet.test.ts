import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RouteBullet from './RouteBullet.vue'

describe('RouteBullet', () => {
  it('renders the label with GTFS colors and the button bevel', () => {
    const w = mount(RouteBullet, {
      props: { label: '6', color: '00933C', textColor: 'FFFFFF' },
    })
    expect(w.text()).toBe('6')
    const cls = w.attributes('class') || ''
    // Same lighting/bevel as a button: hairline border + depth-raised
    expect(cls).toContain('depth-raised')
    expect(cls).toContain('border-white/15')
    expect(cls).toContain('rounded-full')
    const style = w.attributes('style') || ''
    expect(style).toContain('background: #00933C')
    expect(style).toContain('color: #FFFFFF')
  })

  it('strips a leading # and falls back when colors are absent', () => {
    const w = mount(RouteBullet, { props: { label: 'L', color: '#A7A9AC' } })
    // Leading '#' stripped then re-applied → a single, valid hex
    expect(w.attributes('style') || '').toContain('background: #A7A9AC')

    const bare = mount(RouteBullet, { props: { label: 'X' } })
    const bareStyle = bare.attributes('style') || ''
    expect(bareStyle).toContain('var(--primary)') // primary fallback
    expect(bareStyle).toContain('color: #fff') // white text default
  })

  it('md size is larger than sm', () => {
    const sm = mount(RouteBullet, { props: { label: 'N', size: 'sm' } })
    const md = mount(RouteBullet, { props: { label: 'N', size: 'md' } })
    expect(sm.attributes('style')).toContain('height: 22px')
    expect(md.attributes('style')).toContain('height: 26px')
  })

  // ── portolan parity ──────────────────────────────────────────────────

  it('letters a light bullet dark, the way the baker does', () => {
    // the MTA's yellow: white glyphs on it are unreadable, and the map
    // has always drawn them black
    const nqrw = mount(RouteBullet, { props: { label: 'N', color: 'FCCC0A' } })
    expect(nqrw.attributes('style')).toContain('color: #111111')

    const a = mount(RouteBullet, { props: { label: 'A', color: '0039A6' } })
    expect(a.attributes('style')).toContain('color: #ffffff')

    // and the threshold is the baker's, not "is it grey": the L's light
    // grey clears 160 and takes dark glyphs on the map too
    const l = mount(RouteBullet, { props: { label: 'L', color: 'A7A9AC' } })
    expect(l.attributes('style')).toContain('color: #111111')
  })

  it('an explicit text color still wins', () => {
    const w = mount(RouteBullet, { props: { label: 'N', color: 'FCCC0A', textColor: '#003300' } })
    expect(w.attributes('style')).toContain('color: #003300')
  })

  it('wears portolan’s curated outline', () => {
    // Mexico City's metro numerals sit in a notched square
    const notch = mount(RouteBullet, { props: { label: '2', color: '0072CE', shape: 'notch' } })
    const notchStyle = notch.attributes('style') || ''
    expect(notchStyle).toContain('border-radius: 0px 9.4px 0px 0px')
    expect(notch.attributes('class')).not.toContain('rounded-full')

    const square = mount(RouteBullet, { props: { label: '8', color: '009B3A', shape: 'square' } })
    expect(square.attributes('style')).toContain('border-radius: 0')
  })

  it('clips the angular outlines, and drops their border with them', () => {
    const diamond = mount(RouteBullet, { props: { label: 'M', color: 'FF6319', shape: 'diamond' } })
    const style = diamond.attributes('style') || ''
    expect(style).toContain('clip-path: polygon')
    // a clip cuts a border off mid-stroke and the shadow would trace the
    // box rather than the shape
    expect(diamond.attributes('class')).not.toContain('depth-raised')
    // the diamond's inscribed rectangle is barely half its width
    expect(style).toContain('min-width: 31px')
  })

  it('an unknown shape is a circle, not a crash', () => {
    const w = mount(RouteBullet, { props: { label: '1', color: 'D82233', shape: 'blob' } })
    expect(w.attributes('class')).toContain('rounded-full')
  })

  it('a word becomes a pill and two glyphs stay round', () => {
    const word = mount(RouteBullet, { props: { label: 'Brown', color: '62361B' } })
    expect(word.attributes('class')).not.toContain('rounded-full')
    expect(word.attributes('style')).toContain('border-radius: 5.5px')

    const two = mount(RouteBullet, { props: { label: '6X', color: '00933C' } })
    expect(two.attributes('class')).toContain('rounded-full')
  })
})
