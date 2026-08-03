import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import PreferenceRow from './PreferenceRow.vue'
import PreferenceToggle from './PreferenceToggle.vue'
import { providePreferences } from './context'
import type { RoutingPreferences } from '@/types/multimodal.types'

/**
 * Mounts a control inside a host that provides the panel context, mirroring
 * how RoutingPreferences supplies it.
 */
function mountIn(
  Control: unknown,
  props: Record<string, unknown>,
  {
    support = 'range',
    values = {},
  }: { support?: 'range' | 'boolean' | false; values?: Record<string, unknown> } = {},
) {
  const written: Array<[string, unknown]> = []
  const state = ref<Record<string, unknown>>({ ...values })

  const Host = defineComponent({
    setup() {
      providePreferences({
        preferences: computed(() => state.value as Partial<RoutingPreferences>),
        updatePreference: (key, value) => {
          written.push([key as string, value])
          state.value = { ...state.value, [key as string]: value }
        },
        isSupported: () => support !== false,
        isRange: () => support === 'range',
        getHintLabel: (_key, value) => `hint:${value}`,
      })
      return () => h(Control as never, props)
    },
  })

  return { wrapper: mount(Host), written }
}

describe('PreferenceRow', () => {
  it('renders nothing when the engine does not support the preference', () => {
    const { wrapper } = mountIn(PreferenceRow, { pref: 'hills', label: 'Hills' }, {
      support: false,
    })
    expect(wrapper.text()).toBe('')
  })

  it('renders the neutral label and hint as a slider when the engine takes a weight', () => {
    const { wrapper } = mountIn(
      PreferenceRow,
      { pref: 'hills', label: 'Hills', toggleLabel: 'Avoid hills' },
      { support: 'range', values: { hills: 0.25 } },
    )
    expect(wrapper.text()).toContain('Hills')
    expect(wrapper.text()).toContain('hint:0.25')
    // The directional wording belongs to the switch form only.
    expect(wrapper.text()).not.toContain('Avoid hills')
  })

  it('renders the directional label as a switch when the engine takes a flag', () => {
    const { wrapper } = mountIn(
      PreferenceRow,
      { pref: 'hills', label: 'Hills', toggleLabel: 'Avoid hills' },
      { support: 'boolean' },
    )
    expect(wrapper.text()).toContain('Avoid hills')
    expect(wrapper.text()).not.toContain('hint:')
  })

  it('renders nothing in flag mode for a preference with no on/off reading', () => {
    // safetyVsSpeed spans two directions, so it has no toggleLabel.
    const { wrapper } = mountIn(
      PreferenceRow,
      { pref: 'safetyVsSpeed', label: 'Route priority' },
      { support: 'boolean' },
    )
    expect(wrapper.text()).toBe('')
  })

  it('falls back to the supplied default when the preference is unset', () => {
    const { wrapper } = mountIn(
      PreferenceRow,
      { pref: 'surfaceQuality', label: 'Surface', fallback: 0.25 },
      { support: 'range' },
    )
    expect(wrapper.text()).toContain('hint:0.25')
  })

  it('shows end captions only when given', () => {
    const { wrapper } = mountIn(
      PreferenceRow,
      { pref: 'safetyVsSpeed', label: 'Route priority', endLabels: ['Safest', 'Fastest'] },
      { support: 'range' },
    )
    expect(wrapper.text()).toContain('Safest')
    expect(wrapper.text()).toContain('Fastest')
  })

  describe('toggle direction', () => {
    // An avoid-style switch reads as on below the midpoint; a prefer-style
    // one reads as on above it. Getting this backwards silently inverts the
    // control, so both directions are pinned.
    it('below: checked when the weight sits under the midpoint', () => {
      const on = mountIn(PreferenceRow, {
        pref: 'hills', label: 'Hills', toggleLabel: 'Avoid hills',
        on: 0, off: 0.5, toggleWhen: 'below',
      }, { support: 'boolean', values: { hills: 0 } })
      expect(on.wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('true')

      const off = mountIn(PreferenceRow, {
        pref: 'hills', label: 'Hills', toggleLabel: 'Avoid hills',
        on: 0, off: 0.5, toggleWhen: 'below',
      }, { support: 'boolean', values: { hills: 0.5 } })
      expect(off.wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('false')
    })

    it('above: checked when the weight sits over the midpoint', () => {
      const on = mountIn(PreferenceRow, {
        pref: 'litPaths', label: 'Lit paths', toggleLabel: 'Prefer lit paths',
        on: 1, off: 0, fallback: 0,
      }, { support: 'boolean', values: { litPaths: 1 } })
      expect(on.wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('true')

      const off = mountIn(PreferenceRow, {
        pref: 'litPaths', label: 'Lit paths', toggleLabel: 'Prefer lit paths',
        on: 1, off: 0, fallback: 0,
      }, { support: 'boolean', values: { litPaths: 0 } })
      expect(off.wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('false')
    })
  })

  it('writes the on/off values, not a boolean', () => {
    const { wrapper, written } = mountIn(PreferenceRow, {
      pref: 'hills', label: 'Hills', toggleLabel: 'Avoid hills',
      on: 0, off: 0.5, toggleWhen: 'below',
    }, { support: 'boolean', values: { hills: 0.5 } })

    wrapper.find('[role="switch"]').trigger('click')
    expect(written).toEqual([['hills', 0]])
  })
})

describe('PreferenceToggle', () => {
  it('reflects and writes a real boolean', async () => {
    const { wrapper, written } = mountIn(
      PreferenceToggle,
      { pref: 'wheelchairAccessible', label: 'Wheelchair accessible' },
      { support: 'boolean', values: { wheelchairAccessible: false } },
    )
    expect(wrapper.text()).toContain('Wheelchair accessible')
    await wrapper.find('[role="switch"]').trigger('click')
    expect(written).toEqual([['wheelchairAccessible', true]])
  })

  it('hides itself when unsupported', () => {
    const { wrapper } = mountIn(
      PreferenceToggle,
      { pref: 'preferHOV', label: 'Prefer HOV lanes' },
      { support: false },
    )
    expect(wrapper.text()).toBe('')
  })
})
