/**
 * The drawing surface.
 *
 * Everything not yet committed — the shape taking form, the rubber band to
 * the cursor, the vertex handles — is painted on a 2D canvas over the map
 * rather than pushed into the map's style.
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
 * Geometry still comes from `canvas-annotations`, so the shape you drag out
 * is built by the same code that will store it. Only the painting is local.
 */

import { onScopeDispose, watch, type Ref } from 'vue'
import type { Feature, Position } from 'geojson'
import { useMapStore } from '@/stores/map.store'
import { annotationFeature } from '@/lib/canvas-annotations'
import type { CanvasAnnotation } from '@/types/canvas.types'

/** Matches the committed styling in `useCanvasRendering`, so nothing jumps on commit. */
const FILL_OPACITY = 0.18
const STROKE_WIDTH = 3
const GUIDE_COLOR = '#6b7280'
const GUIDE_WIDTH = 2
const GUIDE_DASH = [6, 5]
const HANDLE_RADIUS = 4.5

interface OverlayMap {
  project: (position: Position) => { x: number; y: number }
  getCanvas: () => HTMLCanvasElement
  getCanvasContainer: () => HTMLElement
  on: (event: string, handler: () => void) => void
  off: (event: string, handler: () => void) => void
}

export function useDrawOverlay(state: {
  /** The annotation being drawn, already resolved to its final geometry. */
  draft: Ref<CanvasAnnotation | null>
  /** The rubber band from the last vertex to the cursor. */
  guide: Ref<Feature | null>
  /** Committed vertices, drawn as handles so the shape reads as editable. */
  positions: Ref<Position[]>
  color: Ref<string>
}) {
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
    coordinates.forEach((coordinate, index) => {
      const { x, y } = map.project(coordinate)
      if (index) context.lineTo(x, y)
      else context.moveTo(x, y)
    })
  }

  function paintFeature(
    context: CanvasRenderingContext2D,
    map: OverlayMap,
    feature: Feature,
    style: { color: string; width: number; dash?: number[]; fill?: boolean },
  ) {
    const { geometry } = feature
    context.save()
    context.strokeStyle = style.color
    context.lineWidth = style.width
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.setLineDash(style.dash ?? [])

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

  /** A dot per placed vertex — the shape's joints, and where undo will bite. */
  function paintHandles(
    context: CanvasRenderingContext2D,
    map: OverlayMap,
    positions: Position[],
    color: string,
  ) {
    context.save()
    context.setLineDash([])
    context.lineWidth = 2
    context.strokeStyle = color
    context.fillStyle = '#ffffff'
    for (const position of positions) {
      const { x, y } = map.project(position)
      context.beginPath()
      context.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
    context.restore()
  }

  function paint() {
    frame = 0
    const map = attached
    if (!map || !element) return
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

    const feature = state.draft.value
      ? annotationFeature(state.draft.value)
      : null
    if (feature) {
      paintFeature(context, map, feature, {
        color: state.color.value,
        width: STROKE_WIDTH,
        fill: true,
      })
    }
    if (state.guide.value) {
      paintFeature(context, map, state.guide.value, {
        color: GUIDE_COLOR,
        width: GUIDE_WIDTH,
        dash: GUIDE_DASH,
      })
    }
    paintHandles(context, map, state.positions.value, state.color.value)
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

  // Mounted only while a tool is drawing, so an idle canvas costs nothing.
  watch(
    () => !!state.draft.value || !!state.guide.value || !!state.positions.value.length,
    active => (active ? mount() : unmount()),
    { immediate: true },
  )

  watch(
    [state.draft, state.guide, state.positions, state.color],
    schedule,
    { deep: true },
  )

  onScopeDispose(unmount)

  return { paint, isMounted: () => !!element }
}
