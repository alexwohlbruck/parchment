import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import PropertyField from './PropertyField.vue'
import en from '@/lib/i18n/en-US.json'
import type { StyleProperty } from '@/lib/map-style/spec'

/**
 * The property row carries the editor's two central rules: an unset property
 * shows its spec default without writing it, and a value the controls can't
 * represent (an expression) is handed to JSON rather than flattened.
 */

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } })
const mountOpts = { global: { plugins: [i18n] } }

beforeEach(() => setActivePinia(createPinia()))

const COLOR: StyleProperty = {
  key: 'line-color',
  bag: 'paint',
  section: 'stroke',
  control: 'color',
  label: 'Colour',
  default: '#000000',
}

const WIDTH: StyleProperty = {
  key: 'line-width',
  bag: 'paint',
  section: 'stroke',
  control: 'range',
  label: 'Width',
  default: 1,
  min: 0,
  max: 24,
  step: 0.5,
  unit: 'px',
}

const CAP: StyleProperty = {
  key: 'line-cap',
  bag: 'layout',
  section: 'shape',
  control: 'select',
  label: 'Cap',
  options: ['butt', 'round', 'square'],
  default: 'butt',
}

describe('PropertyField', () => {
  it('offers no reset for a property the user has not set', () => {
    const w = mount(PropertyField, {
      props: { property: COLOR, value: undefined },
      ...mountOpts,
    })

    expect(w.find('button[title="Reset to default"]').exists()).toBe(false)
  })

  it('offers a reset once a value is set, and clears rather than writing the default', async () => {
    const w = mount(PropertyField, {
      props: { property: COLOR, value: '#ff0000' },
      ...mountOpts,
    })

    await w.find('button[title="Reset to default"]').trigger('click')

    expect(w.emitted('clear')).toHaveLength(1)
    expect(w.emitted('update')).toBeUndefined()
  })

  it('shows the spec default for an unset range without claiming it is set', () => {
    const w = mount(PropertyField, {
      props: { property: WIDTH, value: undefined },
      ...mountOpts,
    })

    expect(w.text()).toContain('1px')
    expect(w.find('button[title="Reset to default"]').exists()).toBe(false)
  })

  it('hands an expression to JSON instead of a control', async () => {
    const w = mount(PropertyField, {
      props: {
        property: WIDTH,
        value: ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 4],
      },
      ...mountOpts,
    })

    expect(w.text()).toContain('Expression')
    expect(w.findComponent({ name: 'Slider' }).exists()).toBe(false)

    await w.find('button:not([title])').trigger('click')
    expect(w.emitted('editJson')).toHaveLength(1)
  })

  it('treats a legacy stop function as an expression too', () => {
    const w = mount(PropertyField, {
      props: { property: WIDTH, value: { stops: [[10, 1], [16, 4]] } },
      ...mountOpts,
    })

    expect(w.text()).toContain('Expression')
  })

  it('renders a select for a keyword property', () => {
    const w = mount(PropertyField, {
      props: { property: CAP, value: 'round' },
      ...mountOpts,
    })

    expect(w.text()).toContain('Cap')
  })
})
