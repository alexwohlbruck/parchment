/**
 * The map, as the things you draw on it need it.
 *
 * Drawing reaches past the strategies and talks to the engine's own map
 * instance: it has to unproject a pointer, ask what was drawn under it, and
 * take away the gestures that use the same inputs a tool does. Neither
 * engine's type is ours to widen, so every place that needed one of those
 * used to cast the instance to a one-off shape naming just the parts it
 * touched — nine of them across the drawing tools, each a slightly different
 * guess at the same object.
 *
 * This is that shape, written once. Every member is optional and every
 * helper is a no-op before the map exists, because a canvas can be open
 * before the engine has finished loading.
 */

import type { Position } from 'geojson'
import { useMapStore } from '@/stores/map.store'

/** A gesture the engine can be told to stand down. */
interface Gesture {
  enable: () => void
  disable: () => void
}

export interface DrawingSurface {
  getCanvas?: () => HTMLCanvasElement
  project?: (position: Position) => { x: number; y: number }
  unproject?: (point: [number, number]) => { lng: number; lat: number }
  queryRenderedFeatures?: (
    box: [[number, number], [number, number]],
  ) => { properties?: Record<string, unknown> | null }[]
  dragPan?: Gesture
  doubleClickZoom?: Gesture
  boxZoom?: Gesture
  on?: (event: string, handler: (event: never) => void) => void
  off?: (event: string, handler: (event: never) => void) => void
}

export function useDrawingSurface() {
  const mapStore = useMapStore()

  /** The engine's map instance, or undefined before there is one. */
  const map = () =>
    mapStore.getMapStrategy()?.mapInstance as DrawingSurface | undefined

  /** The element the map draws into — what pointer events are measured from. */
  const element = () => map()?.getCanvas?.()

  function setCursor(cursor: string) {
    const canvas = element()
    if (canvas) canvas.style.cursor = cursor
  }

  /** The cursor, but only if it is still the one we set. */
  function clearCursor(ours: string) {
    const canvas = element()
    if (canvas?.style.cursor === ours) canvas.style.cursor = ''
  }

  /** The map's own drag, which has to stand down for the length of a stroke. */
  function setPanning(enabled: boolean) {
    const gesture = map()?.dragPan
    if (enabled) gesture?.enable()
    else gesture?.disable()
  }

  /**
   * The gestures that share a tool's inputs.
   *
   * Two vertices placed in quick succession read as a double-click, and the
   * map zoomed instead of taking the second point; shift starts a box zoom
   * and swallows the click outright, so holding it to constrain a shape
   * placed nothing at all.
   */
  function setMapGestures(enabled: boolean) {
    const instance = map()
    if (!instance) return
    if (enabled) {
      instance.doubleClickZoom?.enable()
      instance.boxZoom?.enable()
    } else {
      instance.doubleClickZoom?.disable()
      instance.boxZoom?.disable()
    }
  }

  /** Where a pointer event is, in the canvas's own coordinates. */
  function pointAt(event: {
    clientX: number
    clientY: number
  }): { x: number; y: number } | null {
    const canvas = element()
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /** Where a pointer event is, on the ground. */
  function positionAt(event: {
    clientX: number
    clientY: number
  }): Position | null {
    const instance = map()
    const point = pointAt(event)
    if (!instance?.unproject || !point) return null
    const { lng, lat } = instance.unproject([point.x, point.y])
    return [lng, lat]
  }

  /**
   * How far apart two positions are on screen, or null if the map can't say.
   *
   * Judged in pixels rather than metres: two points a metre apart are the
   * same click at one zoom and far apart at another.
   */
  function screenDistance(a: Position, b: Position): number | null {
    const project = map()?.project
    if (!project) return null
    const from = project(a)
    const to = project(b)
    return Math.hypot(from.x - to.x, from.y - to.y)
  }

  /**
   * The ids of everything the engine drew within `radius` pixels of a point.
   *
   * Asking the engine rather than hit-testing the geometry here: a mark is as
   * thick as its stroke and as big as its label, and only the thing that
   * painted it knows that. Everything else drawn there comes back too — the
   * basemap's own features included — so the caller decides which are its.
   */
  function idsAround(position: Position, radius: number): string[] {
    const instance = map()
    if (!instance?.project || !instance.queryRenderedFeatures) return []
    const { x, y } = instance.project(position)
    return instance
      .queryRenderedFeatures([
        [x - radius, y - radius],
        [x + radius, y + radius],
      ])
      .map(feature => feature.properties?.id)
      .filter((id): id is string => typeof id === 'string')
  }

  return {
    map,
    element,
    setCursor,
    clearCursor,
    setPanning,
    setMapGestures,
    pointAt,
    positionAt,
    screenDistance,
    idsAround,
  }
}
