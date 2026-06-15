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
    expect(sm.attributes('class')).toContain('h-[22px]')
    expect(md.attributes('class')).toContain('h-[26px]')
  })
})
