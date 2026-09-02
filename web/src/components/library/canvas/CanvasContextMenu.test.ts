import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import CanvasContextMenu from './CanvasContextMenu.vue'
import { useMapStore } from '@/stores/map.store'
import { MapEngine } from '@/types/map.types'
import en from '@/lib/i18n/en-US.json'
import type { Canvas, CanvasMapSettings } from '@/types/canvas.types'

/**
 * The canvas header's overflow, and in particular the map appearance it
 * carries. Two things have to hold for those switches to read honestly: they
 * can only offer what the engine can actually answer, and while the canvas
 * has no set of its own they have to report the app's answers rather than
 * going blank or, worse, showing false.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': en },
})

/** The dropdown is machinery; this test is about the menu handed to it. */
const DropdownStub = defineComponent({
  name: 'ResponsiveDropdown',
  props: { items: { type: Array, default: () => [] } },
  template: '<div />',
})

/** The canvases service reaches for the router on the way in. */
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
})

const canvas = { id: 'c1', name: 'Booty' } as unknown as Canvas

function settings(overrides: Partial<CanvasMapSettings> = {}): CanvasMapSettings {
  return {
    objects3d: false,
    terrain3d: false,
    hdRoads: false,
    indoorMaps: false,
    poiLabels: false,
    roadLabels: false,
    transitLabels: false,
    placeLabels: false,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

/* eslint-disable @typescript-eslint/no-explicit-any */
function render(mapSettings?: CanvasMapSettings) {
  const wrapper = mount(CanvasContextMenu, {
    props: { canvas, mapSettings },
    global: {
      plugins: [i18n, router],
      stubs: { ResponsiveDropdown: DropdownStub },
    },
  })
  const items = () =>
    wrapper.findComponent(DropdownStub).props('items') as any[]
  const appearance = () => items().find(i => i.id === 'appearance')
  return {
    wrapper,
    items,
    appearance,
    /** The setting rows, without the switch that turns overriding on. */
    rows: () =>
      appearance().items.filter((i: any) => i.type === 'item' && i.id !== 'override'),
    override: () => appearance().items.find((i: any) => i.id === 'override'),
    emitted: () => wrapper.emitted('update:mapSettings') as [CanvasMapSettings | undefined][],
  }
}

describe('what the menu offers', () => {
  it('carries appearance, rename and delete', () => {
    const ids = render().items().map(i => i.id).filter(Boolean)
    expect(ids).toEqual(['appearance', 'edit', 'delete'])
  })

  it('marks the appearance submenu when the canvas is dressing the map', () => {
    expect(render(settings()).appearance().active).toBe(true)
    expect(render().appearance().active).toBe(false)
  })
})

describe('which switches a canvas is offered', () => {
  it('offers the Mapbox-only ones on Mapbox', () => {
    useMapStore().settings.engine = MapEngine.MAPBOX
    expect(render(settings()).rows()).toHaveLength(8)
  })

  it('leaves them out on MapLibre, which has no answer to give', () => {
    useMapStore().settings.engine = MapEngine.MAPLIBRE
    const rows = render(settings()).rows()
    expect(rows).toHaveLength(5)
    expect(rows.map(r => r.id)).not.toContain('terrain3d')
  })
})

describe('a canvas with no appearance of its own', () => {
  beforeEach(() => {
    const store = useMapStore()
    store.settings.engine = MapEngine.MAPLIBRE
    store.settings.poiLabels = true
    store.settings.roadLabels = false
  })

  it('reports what the app is set to, rather than nothing', () => {
    const rows = render().rows()
    const value = (id: string) =>
      rows.find(r => r.id === id).trailingProps.modelValue
    expect(value('poiLabels')).toBe(true)
    expect(value('roadLabels')).toBe(false)
  })

  it('does not let them be moved until the canvas takes its own set', () => {
    for (const row of render().rows()) {
      expect(row.disabled).toBe(true)
      expect(row.trailingProps.disabled).toBe(true)
    }
  })

  it('starts from the app\'s answers when switched on', () => {
    const menu = render()
    menu.override().onSelect()
    const [[next]] = menu.emitted()
    expect(next).toMatchObject({ poiLabels: true, roadLabels: false })
  })
})

describe('a canvas with its own appearance', () => {
  beforeEach(() => {
    const store = useMapStore()
    store.settings.engine = MapEngine.MAPLIBRE
    // Deliberately the opposite of the canvas's answer below.
    store.settings.poiLabels = false
  })

  it('shows the canvas\'s answer, not the app\'s', () => {
    const row = render(settings({ poiLabels: true }))
      .rows()
      .find(r => r.id === 'poiLabels')
    expect(row.trailingProps.modelValue).toBe(true)
    expect(row.disabled).toBe(false)
  })

  it('hands the whole set back when one switch moves', () => {
    const menu = render(settings({ poiLabels: true }))
    menu.rows().find(r => r.id === 'poiLabels').onSelect()
    const [[next]] = menu.emitted()
    expect(next).toMatchObject({ poiLabels: false, roadLabels: false })
  })

  it('drops back to following the app when switched off', () => {
    const menu = render(settings())
    menu.override().onSelect()
    expect(menu.emitted()).toEqual([[undefined]])
  })

  it('keeps the menu open while the switches are being worked', () => {
    const menu = render(settings())
    expect(menu.override().keepOpen).toBe(true)
    for (const row of menu.rows()) expect(row.keepOpen).toBe(true)
  })
})
