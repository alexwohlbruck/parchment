import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Position } from 'geojson'
import { useMapStore } from '@/stores/map.store'
import { useDrawOverlay } from './useDrawOverlay'
import type { CanvasAnnotation } from '@/types/canvas.types'
import { guideFeature } from '@/lib/canvas-annotations'

/**
 * The overlay exists so that drawing never touches the map's style — pushing
 * a rubber band through a GeoJSON source meant a worker round trip per frame,
 * and a changed source spec tears down every layer drawn from it. So what is
 * worth pinning down is that it stays off the style, stays out of the way of
 * clicks, and cleans up after itself.
 */

/** A 2D context that records the calls made against it. */
function recordingContext() {
  const calls: string[] = []
  const context = new Proxy(
    { calls },
    {
      get(target: any, property: string) {
        if (property in target) return target[property]
        return (...args: unknown[]) => {
          calls.push(`${property}:${JSON.stringify(args)}`)
        }
      },
      set(target: any, property: string, value: unknown) {
        target[property] = value
        calls.push(`${property}=${String(value)}`)
        return true
      },
    },
  )
  return context as { calls: string[] } & CanvasRenderingContext2D
}

let context: ReturnType<typeof recordingContext>

function fakeMap() {
  // Mirrors the real DOM: the canvas container is `position: static` with
  // absolutely positioned children, so it collapses to zero height. Sizing
  // the overlay from it produced a canvas nothing could be drawn on.
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: 800 })
  Object.defineProperty(container, 'clientHeight', { value: 0 })
  const gl = document.createElement('canvas')
  Object.defineProperty(gl, 'clientWidth', { value: 800 })
  Object.defineProperty(gl, 'clientHeight', { value: 600 })
  container.appendChild(gl)
  const handlers = new Map<string, Set<() => void>>()

  return {
    container,
    gl,
    handlers,
    projected: [] as Position[],
    project(position: Position) {
      this.projected.push(position)
      // A stand-in projection: enough to tell one coordinate from another.
      return { x: position[0] * 10, y: position[1] * 10 }
    },
    getCanvas: () => gl,
    getCanvasContainer: () => container,
    on(event: string, handler: () => void) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    off(event: string, handler: () => void) {
      handlers.get(event)?.delete(handler)
    },
    emit(event: string) {
      handlers.get(event)?.forEach(handler => handler())
    },
  }
}

let map: ReturnType<typeof fakeMap>

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  map = fakeMap()
  useMapStore().setMapStrategy({ mapInstance: map } as never)
  context = recordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as never,
  )
})

function overlay(state: {
  draft?: CanvasAnnotation | null
  guide?: ReturnType<typeof guideFeature>
  positions?: Position[]
}) {
  const refs = {
    draft: ref(state.draft ?? null),
    guide: ref(state.guide ?? null),
    positions: ref(state.positions ?? []),
    color: ref('#e11d48'),
  }
  const scope = effectScope()
  const api = scope.run(() => useDrawOverlay(refs as never))!
  return { ...api, ...refs, dispose: () => scope.stop() }
}

const element = () =>
  map.container.querySelector<HTMLCanvasElement>('[data-testid="draw-overlay"]')

describe('useDrawOverlay', () => {
  it('stays off the map until there is something to draw', () => {
    const surface = overlay({})
    expect(element()).toBeNull()
    surface.dispose()
  })

  it('never takes a click away from the map', () => {
    const surface = overlay({ positions: [[1, 1]] })
    expect(element()!.style.pointerEvents).toBe('none')
    surface.dispose()
  })

  it('draws the shape and its rubber band through the map projection', () => {
    const surface = overlay({
      draft: {
        id: 'annotation-draft',
        tool: 'rectangle',
        positions: [
          [0, 0],
          [2, 2],
        ],
        color: '#e11d48',
      } as CanvasAnnotation,
      guide: guideFeature('polygon', [[0, 0], [2, 2]], [3, 3]),
      positions: [
        [0, 0],
        [2, 2],
      ],
    })

    expect(map.projected.length).toBeGreaterThan(0)
    // The rubber band is dashed, so a proposal never reads as a commitment.
    expect(context.calls).toContain('setLineDash:[[6,5]]')
    expect(context.calls.some(call => call.startsWith('clearRect'))).toBe(true)
    surface.dispose()
  })

  it('matches the map canvas, not its collapsed container', () => {
    const surface = overlay({ positions: [[1, 1]] })

    // Device pixels for the backing store, CSS pixels for the box.
    const ratio = window.devicePixelRatio || 1
    expect(element()!.width).toBe(Math.round(800 * ratio))
    expect(element()!.height).toBe(Math.round(600 * ratio))
    expect(element()!.style.height).toBe('600px')
    surface.dispose()
  })

  it('repaints when the camera moves, so it cannot lag behind the basemap', () => {
    const surface = overlay({ positions: [[1, 1]] })

    context.calls.length = 0
    map.emit('render')

    expect(context.calls.some(call => call.startsWith('clearRect'))).toBe(true)
    surface.dispose()
  })

  it('comes off the map when drawing stops', async () => {
    const surface = overlay({ positions: [[1, 1]] })
    expect(element()).not.toBeNull()

    surface.positions.value = []
    await nextTick()

    expect(element()).toBeNull()
    expect(map.handlers.get('render')?.size ?? 0).toBe(0)
  })

  it('leaves nothing behind when the editor closes', () => {
    const surface = overlay({ positions: [[1, 1]] })

    surface.dispose()

    expect(element()).toBeNull()
    expect(map.handlers.get('render')?.size ?? 0).toBe(0)
  })
})
