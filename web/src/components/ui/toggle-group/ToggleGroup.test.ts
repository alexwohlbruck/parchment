import { describe, it, expect } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import ToggleGroup from './ToggleGroup.vue'
import ToggleGroupItem from './ToggleGroupItem.vue'

/**
 * Controlled usage: the parent owns the value (e.g. the isochrone travel mode
 * lives in a store). The wrappers must forward prop *updates*, not a snapshot
 * taken at setup, or the pressed indicator stays stuck on the initial item.
 */
const Harness = defineComponent({
  setup() {
    const value = ref('walk')
    return { value }
  },
  render() {
    return h(
      ToggleGroup,
      {
        type: 'single',
        modelValue: this.value,
        // reka's emit is typed for every ToggleGroup shape, so the payload is
        // `AcceptableValue | AcceptableValue[]` — including null when the
        // active item is deselected. This harness is single-select over
        // strings, so narrow it here rather than widening `value`.
        'onUpdate:modelValue': (v: unknown) => {
          if (typeof v === 'string') this.value = v
        },
      },
      () =>
        ['walk', 'bike'].map(id =>
          h(ToggleGroupItem, { value: id, key: id }, () => id),
        ),
    )
  },
})

function states(w: ReturnType<typeof mount>) {
  return w.findAll('button').map(b => b.attributes('data-state'))
}

describe('ToggleGroup', () => {
  it('reflects the initial controlled value', () => {
    expect(states(mount(Harness))).toEqual(['on', 'off'])
  })

  it('updates the pressed item when the controlled value changes externally', async () => {
    const w = mount(Harness)
    w.vm.value = 'bike'
    await nextTick()
    expect(states(w)).toEqual(['off', 'on'])
  })

  it('updates the pressed item when an item is clicked', async () => {
    const w = mount(Harness)
    await w.findAll('button')[1].trigger('click')
    await nextTick()
    expect(w.vm.value).toBe('bike')
    expect(states(w)).toEqual(['off', 'on'])
  })
})
