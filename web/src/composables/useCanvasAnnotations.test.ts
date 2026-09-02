import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useCanvasAnnotations } from './useCanvasAnnotations'
import { mapEventBus } from '@/lib/eventBus'
import { fetchIsochroneBands } from '@/lib/isochrone-request'
import type { CanvasAnnotation } from '@/types/canvas.types'
import type { DrawStyle } from '@/lib/canvas-draw-style'

/**
 * What a tool does to the map while it is armed.
 *
 * The map's own gestures use the same inputs the tools need — shift starts a
 * box zoom, a double-click zooms in — so arming has to take them away and
 * disarming has to give them back. Getting that wrong is silent: the shape
 * simply never gains a point.
 */

vi.mock('@/lib/route-snapping', () => ({
  RouteSnapAborted: class extends Error {},
  snapWaypointsToPath: vi.fn(async () => null),
}))

vi.mock('@/lib/isochrone-request', () => ({
  fetchIsochroneBands: vi.fn(),
}))

function fakeMap() {
  const canvas = document.createElement('canvas')
  return {
    canvas,
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    boxZoom: { enable: vi.fn(), disable: vi.fn() },
    getCanvas: () => canvas,
    project: (position: number[]) => ({ x: position[0], y: position[1] }),
    queryRenderedFeatures: vi.fn(() => [] as { properties: { id: string } }[]),
    on: vi.fn(),
    off: vi.fn(),
  }
}

let map: ReturnType<typeof fakeMap>

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  map = fakeMap()
  useMapStore().setMapStrategy({ mapInstance: map } as never)
})

function tools(
  onCommit: (a: CanvasAnnotation) => void = () => {},
  styleFor: () => DrawStyle = () => ({}),
  erase: { target?: (ids: string[]) => string | null; onErase?: (id: string) => void } = {},
) {
  const scope = effectScope()
  const api = scope.run(() =>
    useCanvasAnnotations({
      onCommit,
      styleFor,
      eraseTarget: erase.target ?? (ids => ids[0] ?? null),
      onErase: erase.onErase ?? (() => {}),
    }),
  )!
  return { ...api, dispose: () => scope.stop() }
}

describe('useCanvasAnnotations', () => {
  it('takes the map gestures that share its inputs, and gives them back', () => {
    const session = tools()

    session.arm('polygon')
    // Shift+click is the engine's box zoom, and it swallows the click whole —
    // so holding shift to constrain a shape placed nothing at all.
    expect(map.boxZoom.disable).toHaveBeenCalled()
    expect(map.doubleClickZoom.disable).toHaveBeenCalled()

    session.disarm()
    expect(map.boxZoom.enable).toHaveBeenCalled()
    expect(map.doubleClickZoom.enable).toHaveBeenCalled()
    session.dispose()
  })

  it('claims the raw click and Escape while a tool is armed', () => {
    const mapTools = useMapToolsStore()
    const session = tools()

    session.arm('pin')
    expect(mapTools.rawClickCapture).toBe(true)
    expect(mapTools.escapeCapture).toBe(true)

    session.disarm()
    expect(mapTools.rawClickCapture).toBe(false)
    expect(mapTools.escapeCapture).toBe(false)
    session.dispose()
  })

  it('gives the map back when the editor closes mid-shape', () => {
    const mapTools = useMapToolsStore()
    const session = tools()
    session.arm('line')

    session.dispose()

    expect(map.boxZoom.enable).toHaveBeenCalled()
    expect(mapTools.escapeCapture).toBe(false)
  })

  it('refuses the route tool when nothing can plan a route', () => {
    const integrations = useIntegrationsStore()
    vi.spyOn(integrations, 'isRoutingActive', 'get').mockReturnValue(false)
    const session = tools()

    session.arm('route')

    // Better not to arm than to arm and fail on the first click.
    expect(session.tool.value).toBeNull()
    expect(session.canRoute.value).toBe(false)
    session.dispose()
  })

  it('arms the route tool when something can', () => {
    const integrations = useIntegrationsStore()
    vi.spyOn(integrations, 'isRoutingActive', 'get').mockReturnValue(true)
    const session = tools()

    session.arm('route')

    expect(session.tool.value).toBe('route')
    session.dispose()
  })
})

describe('the eraser', () => {
  function erase(target: (ids: string[]) => string | null) {
    const erased: string[] = []
    const session = tools(() => {}, () => ({}), {
      target,
      onErase: id => erased.push(id),
    })
    session.arm('erase')
    mapEventBus.emit('click', { lngLat: { lng: 1, lat: 2 } } as never)
    return { session, erased }
  }

  it('takes off the mark under the pointer', () => {
    map.queryRenderedFeatures.mockReturnValue([
      { properties: { id: 'poi-9' } },
      { properties: { id: 'an-1' } },
    ])
    // The map answers with everything it drew there; the canvas picks its own.
    const { session, erased } = erase(ids => ids.find(id => id === 'an-1') ?? null)

    expect(erased).toEqual(['an-1'])
    session.dispose()
  })

  it('does nothing over bare map', () => {
    map.queryRenderedFeatures.mockReturnValue([])
    const { session, erased } = erase(() => null)

    expect(erased).toEqual([])
    session.dispose()
  })

  it('draws nothing while it is in hand', () => {
    map.queryRenderedFeatures.mockReturnValue([])
    const marks: CanvasAnnotation[] = []
    const session = tools(mark => marks.push(mark), () => ({}), {
      target: () => null,
    })
    session.arm('erase')
    mapEventBus.emit('click', { lngLat: { lng: 1, lat: 2 } } as never)

    // An eraser that left a pin behind would be a poor eraser.
    expect(marks).toEqual([])
    expect(session.scene.value).toBeNull()
    session.dispose()
  })
})

describe('what the tool is set to', () => {
  /** A pin commits on its first click, so one click is a whole mark. */
  function drawPin(styleFor: () => DrawStyle) {
    const marks: CanvasAnnotation[] = []
    const session = tools(mark => marks.push(mark), styleFor)
    session.arm('pin')
    mapEventBus.emit('click', { lngLat: { lng: 1, lat: 2 } } as never)
    session.dispose()
    return marks[0]
  }

  it('draws the mark with the settings on the bar', () => {
    const mark = drawPin(() => ({
      color: 'ruby',
      icon: 'Train',
      markerShape: 'square',
    }))

    expect(mark).toMatchObject({
      color: 'ruby',
      icon: 'Train',
      markerShape: 'square',
    })
  })

  it('writes nothing a setting did not ask for', () => {
    // A mark nobody styled stays as small in the document as it always was.
    const mark = drawPin(() => ({}))

    expect(mark.color).toBe('compass')
    expect(mark.markerSize).toBeUndefined()
    expect(mark.markerShape).toBeUndefined()
  })
})

/**
 * An isochrone is the one tool whose mark is not finished by the user: the
 * origin is clicked, the engine supplies the shape, and only then is there
 * anything to keep. Changing the reach in the meantime asks again — and the
 * ask it replaces must leave the origin alone, or the answer still on its
 * way arrives to find nothing to attach itself to.
 */
describe('an isochrone whose reach changes while the engine is thinking', () => {
  const band = {
    bands: [
      {
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        },
      },
    ],
  }

  it('still lands the mark the second answer is for', async () => {
    useIntegrationsStore()
    vi.spyOn(useIntegrationsStore(), 'isRoutingActive', 'get').mockReturnValue(
      true,
    )
    const committed: CanvasAnnotation[] = []
    const fetched = vi.mocked(fetchIsochroneBands)

    // The first ask never answers; it is abandoned when the reach changes.
    let release: (value: unknown) => void = () => {}
    fetched.mockImplementationOnce(
      (({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const aborted = new Error('aborted')
            aborted.name = 'AbortError'
            reject(aborted)
          })
        })) as never,
    )
    fetched.mockImplementationOnce(
      (() =>
        new Promise(resolve => {
          release = resolve
        })) as never,
    )

    const session = tools(annotation => committed.push(annotation))
    session.arm('isochrone')
    mapEventBus.emit('click', { lngLat: { lng: 1, lat: 2 } } as never)
    await Promise.resolve()

    session.isochroneMinutes.value = 30
    // Let the abandoned ask reject before the live one answers.
    await Promise.resolve()
    await Promise.resolve()
    release(band)
    await Promise.resolve()
    await Promise.resolve()

    expect(committed).toHaveLength(1)
    expect(committed[0].isochrone?.minutes).toBe(30)
    session.dispose()
  })
})
