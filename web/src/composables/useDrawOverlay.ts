/**
 * The drawing surface.
 *
 * Everything not committed to the canvas — the shape taking form under the
 * cursor, the rubber band to the next point, the handles a finished mark is
 * reshaped by — is painted on a 2D canvas over the map rather than pushed
 * into the map's style.
 *
 * The style is the wrong place for work in progress. Changing a GeoJSON
 * source is a round trip to the worker: serialise, re-index, re-tile, hand
 * back, repaint. Doing that on every pointer frame is what made drawing lag,
 * and doing it by dropping the source and rebuilding its layers — which is
 * what a changed source spec forces — rebuilt every other layer on the canvas
 * along with it. Committed marks stay in the style, where they need to be:
 * under labels, clickable, and surviving a basemap change. A rubber band
 * needs none of that; it needs to be on the glass, now.
 *
 * This paints a scene and nothing else. Geometry comes from
 * `canvas-annotations`, so the shape you drag out is built by the same code
 * that will store it, and who is drawing — a tool, or a drag on a handle —
 * is the caller's business.
 */

import { onScopeDispose, watch, type ComputedRef } from 'vue'
import type { Feature, Position } from 'geojson'
import { useMapStore } from '@/stores/map.store'
import { mercatorLerp } from '@/lib/canvas-annotations'

/** Matches the committed styling in `useCanvasRendering`, so nothing jumps on commit. */
const FILL_OPACITY = 0.18
const STROKE_WIDTH = 3
const GUIDE_COLOR = '#6b7280'
const GUIDE_WIDTH = 2
const GUIDE_DASH = [6, 5]
const VERTEX_RADIUS = 4.5
const MIDPOINT_RADIUS = 3
const ACTIVE_RADIUS = 7
/**
 * How long a painted segment gets before it is split, in pixels. The map
 * draws an edge as a line that is straight in Web Mercator, which is a curve
 * on screen under a globe projection — so a long edge is walked rather than
 * jumped, or the preview would cut the corner the committed shape takes.
 */
const SEGMENT_PX = 24
const MAX_SEGMENTS = 48
/**
 * The shape crawls while something is being worked out for it — a route
 * being asked of the server. Marching ants say "still going" without moving
 * the geometry, which would read as the answer arriving.
 */
const PENDING_DASH = [9, 7]
const PENDING_PIXELS_PER_SECOND = 26

export interface OverlayHandle {
  position: Position
  /**
   * A vertex is a point the shape is built from; a midpoint is where one
   * could be added; a radius sets how wide a circle is.
   */
  kind: 'vertex' | 'midpoint' | 'radius'
  /** Drawn larger with a ring, to say the next click will land here. */
  active?: boolean
}

export interface OverlayScene {
  /** The shape being drawn or reshaped. */
  shape: Feature | null
  color: string
  /** The rubber band from the last point to the cursor. */
  guide: Feature | null
  handles: OverlayHandle[]
  /** Something is still being computed for this shape — crawl its outline. */
  pending?: boolean
}

interface OverlayMap {
  project: (position: Position) => { x: number; y: number }
  getCanvas: () => HTMLCanvasElement
  getCanvasContainer: () => HTMLElement
  on: (event: string, handler: () => void) => void
  off: (event: string, handler: () => void) => void
}

export function useDrawOverlay(scene: ComputedRef<OverlayScene | null>) {
  const mapStore = useMapStore()

  let element: HTMLCanvasElement | undefined
  let attached: OverlayMap | undefined
  let frame = 0

  function mapInstance(): OverlayMap | undefined {
    return mapStore.getMapStrategy()?.mapInstance as OverlayMap | undefined
  }

  function trace(
    context: CanvasRenderingContext2D,
    map: OverlayMap,
    coordinates: Position[],
  ) {
    context.beginPath()
    let previous: Position | undefined
    for (const coordinate of coordinates) {
      const point = map.project(coordinate)
      if (!previous) {
        context.moveTo(point.x, point.y)
        previous = coordinate
        continue
      }

      const from = map.project(previous)
      const span = Math.hypot(point.x - from.x, point.y - from.y)
      const steps = Math.min(
        MAX_SEGMENTS,
        Math.max(1, Math.ceil(span / SEGMENT_PX)),
      )
      for (let step = 1; step < steps; step++) {
        const between = map.project(
          mercatorLerp(previous, coordinate, step / steps),
        )
        context.lineTo(between.x, between.y)
      }
      context.lineTo(point.x, point.y)
      previous = coordinate
    }
  }

  function paintFeature(
    context: CanvasRenderingContext2D,
    map: OverlayMap,
    feature: Feature,
    style: {
      color: string
      width: number
      dash?: number[]
      dashOffset?: number
      fill?: boolean
    },
  ) {
    const { geometry } = feature
    context.save()
    context.strokeStyle = style.color
    context.lineWidth = style.width
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.setLineDash(style.dash ?? [])
    context.lineDashOffset = style.dashOffset ?? 0

    if (geometry.type === 'Point') {
      const { x, y } = map.project(geometry.coordinates)
      context.beginPath()
      context.arc(x, y, 7, 0, Math.PI * 2)
      context.fillStyle = style.color
      context.fill()
      context.strokeStyle = '#ffffff'
      context.lineWidth = 2.5
      context.stroke()
    } else if (geometry.type === 'LineString') {
      trace(context, map, geometry.coordinates)
      context.stroke()
    } else if (geometry.type === 'Polygon') {
      trace(context, map, geometry.coordinates[0])
      context.closePath()
      if (style.fill) {
        context.fillStyle = style.color
        context.globalAlpha = FILL_OPACITY
        context.fill()
        context.globalAlpha = 1
      }
      context.stroke()
    }
    context.restore()
  }

  /**
   * The shape's joints. A midpoint is drawn smaller and faded because it is
   * an offer rather than a part of the shape — drag it and it becomes one.
   */
  function paintHandles(
    context: CanvasRenderingContext2D,
    map: OverlayMap,
    handles: OverlayHandle[],
    color: string,
  ) {
    context.save()
    context.setLineDash([])
    for (const handle of handles) {
      const { x, y } = map.project(handle.position)
      const radius = handle.active
        ? ACTIVE_RADIUS
        : handle.kind === 'midpoint'
          ? MIDPOINT_RADIUS
          : VERTEX_RADIUS

      context.globalAlpha = handle.kind === 'midpoint' && !handle.active ? 0.55 : 1
      context.lineWidth = 2
      context.strokeStyle = color
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
      context.stroke()

      // A ring says the click is already caught, before it happens.
      if (handle.active) {
        context.globalAlpha = 0.35
        context.beginPath()
        context.arc(x, y, radius + 4, 0, Math.PI * 2)
        context.stroke()
      }
      context.globalAlpha = 1
    }
    context.restore()
  }

  function paint() {
    frame = 0
    const map = attached
    const current = scene.value
    if (!map || !element || !current) return
    const context = element.getContext('2d')
    if (!context) return

    // Sized against the map's own canvas, never its container: the container
    // is `position: static` with absolutely positioned children, so it
    // collapses to zero height and would size this to nothing.
    const gl = map.getCanvas()
    const width = gl.clientWidth
    const height = gl.clientHeight
    const ratio = window.devicePixelRatio || 1
    if (!width || !height) return

    // Resizing clears the canvas, so only do it when the size actually moved.
    if (
      element.width !== Math.round(width * ratio) ||
      element.height !== Math.round(height * ratio)
    ) {
      element.width = Math.round(width * ratio)
      element.height = Math.round(height * ratio)
      element.style.width = `${width}px`
      element.style.height = `${height}px`
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)

    if (current.shape) {
      paintFeature(context, map, current.shape, {
        color: current.color,
        width: STROKE_WIDTH,
        fill: true,
        dash: current.pending ? PENDING_DASH : undefined,
        dashOffset: current.pending
          ? -((performance.now() / 1000) * PENDING_PIXELS_PER_SECOND)
          : 0,
      })
    }
    if (current.guide) {
      paintFeature(context, map, current.guide, {
        color: GUIDE_COLOR,
        width: GUIDE_WIDTH,
        dash: GUIDE_DASH,
      })
    }
    paintHandles(context, map, current.handles, current.color)

    // Keep the ants marching. Nothing else drives a repaint while the map
    // sits still and the pointer isn't moving.
    if (current.pending) schedule()
  }

  /**
   * Repaint on the next frame. The map's own `render` event drives painting
   * while the camera moves — synchronously, so the overlay can't lag a frame
   * behind the basemap — and this covers the rest, when only the pointer has
   * moved and the map is sitting still.
   */
  function schedule() {
    if (frame) return
    frame = requestAnimationFrame(paint)
  }

  function mount() {
    if (element) return
    const map = mapInstance()
    if (!map?.getCanvasContainer) return

    element = document.createElement('canvas')
    element.dataset.testid = 'draw-overlay'
    Object.assign(element.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      // The map still owns every click; this is glass, not a target.
      pointerEvents: 'none',
      zIndex: '2',
    })
    map.getCanvasContainer().appendChild(element)
    map.on('render', paint)
    attached = map
    paint()
  }

  function unmount() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    attached?.off('render', paint)
    element?.remove()
    attached = undefined
    element = undefined
  }

  // Mounted only while there is something to draw, so an idle canvas costs
  // nothing at all.
  watch(
    () => !!scene.value,
    active => (active ? mount() : unmount()),
    { immediate: true },
  )

  watch(scene, schedule, { deep: true })

  onScopeDispose(unmount)

  return { paint, isMounted: () => !!element }
}
