import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useCanvasAnnotations } from './useCanvasAnnotations'
import { mapEventBus } from '@/lib/eventBus'
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

function fakeMap() {
  const canvas = document.createElement('canvas')
  return {
    canvas,
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    boxZoom: { enable: vi.fn(), disable: vi.fn() },
    getCanvas: () => canvas,
    project: (position: number[]) => ({ x: position[0], y: position[1] }),
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
) {
  const scope = effectScope()
  const api = scope.run(() => useCanvasAnnotations({ onCommit, styleFor }))!
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
