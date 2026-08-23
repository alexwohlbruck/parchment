/**
 * The canvas drawing tools.
 *
 * A tool is armed for as long as you keep drawing with it, the way it works
 * in Felt — pick Pin, drop as many pins as you like, press Escape when you're
 * done. Tools that know when they're finished (a pin, a rectangle's second
 * corner, a circle's edge) commit themselves; the open-ended ones (line,
 * polygon) collect until you press Done.
 *
 * While a tool is armed it takes the map's click event over entirely — the
 * same mechanism the measure tool uses — so clicking the map draws instead of
 * opening whatever is underneath.
 */

import { computed, onScopeDispose, ref, watch } from 'vue'
import type { Position } from 'geojson'
import { mapEventBus } from '@/lib/eventBus'
import { useMapStore } from '@/stores/map.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { themeColorToHex } from '@/lib/utils'
import type { OverlayScene } from '@/composables/useDrawOverlay'
import {
  RouteSnapAborted,
  snapWaypointsToPath,
} from '@/lib/route-snapping'
import type { RouteMode } from '@/types/routes.types'
import type { IsochroneMode } from '@server/types/isochrone.types'
import { fetchIsochroneBands } from '@/lib/isochrone-request'
import { contourDurations } from '@/lib/isochrone.utils'
import type { LngLat, MapEvents } from '@/types/map.types'
import type { AnnotationTool, CanvasAnnotation } from '@/types/canvas.types'
import {
  annotationFeature,
  constrainPosition,
  DEFAULT_DOODLE_WIDTH,
  smoothStroke,
  createAnnotation,
  guideFeature,
  isComplete,
  TOOL_AUTOCOMPLETES,
  TOOL_MINIMUM,
  DEFAULT_ANNOTATION_COLOR,
} from '@/lib/canvas-annotations'

/** How close to the first vertex closing a shape starts to pull, in pixels. */
const SNAP_PX = 12

/** How many clicks a tool needs before the cursor completes its shape. */
const PREVIEW_AT: Partial<Record<AnnotationTool, number>> = {
  rectangle: 2,
  circle: 1,
}

export function useCanvasAnnotations(options: {
  /** Called with each finished annotation. */
  onCommit: (annotation: CanvasAnnotation) => void
}) {
  const mapStore = useMapStore()
  const mapToolsStore = useMapToolsStore()
  const integrationsStore = useIntegrationsStore()

  /** The Route tool needs a routing engine; without one it isn't offered. */
  const canRoute = computed(() => integrationsStore.isRoutingActive)

  /**
   * Put the map into drawing mode, and take it back out again.
   *
   * Double-click zoom is the important half: two vertices placed close
   * together in quick succession read as a double-click, and the map zoomed
   * instead of taking the second point. The crosshair is the other half —
   * a map that behaves differently should look like it does.
   */
  function setDrawingMode(active: boolean) {
    // Take the click away from the basemap's POI interaction: it would win
    // the click and re-emit it at the POI's centre, so a vertex dropped near
    // a cafe would land on the cafe. It also stops POI hover stealing the
    // cursor back — see the strategies' hover handlers.
    mapToolsStore.rawClickCapture = active
    // Escape belongs to the tool while one is armed — see the store.
    mapToolsStore.escapeCapture = active

    const map = mapStore.getMapStrategy()?.mapInstance as
      | {
          doubleClickZoom?: { enable: () => void; disable: () => void }
          boxZoom?: { enable: () => void; disable: () => void }
          getCanvas?: () => HTMLCanvasElement
        }
      | undefined
    if (!map) return
    if (active) {
      map.doubleClickZoom?.disable()
      // Shift+click is the engine's box zoom, and it swallows the click
      // outright — so holding shift to constrain a shape placed nothing at
      // all. The tool needs the modifier more than the map does.
      map.boxZoom?.disable()
    } else {
      map.doubleClickZoom?.enable()
      map.boxZoom?.enable()
    }
    applyCursor()
  }

  const tool = ref<AnnotationTool | null>(null)
  const color = ref(DEFAULT_ANNOTATION_COLOR)
  /** Positions clicked for the annotation currently being drawn. */
  const positions = ref<Position[]>([])
  /**
   * Where the pointer is, while a tool is armed.
   *
   * Without this, drawing is blind between clicks: a rectangle is invisible
   * until its second corner lands, and a polygon gives no sense of the edge
   * you are about to commit. Tracked on the map instance rather than the
   * shared event bus — nothing else needs it, and it fires constantly.
   */
  const cursor = ref<Position | null>(null)
  /**
   * Whether shift is down. Held keys constrain what the next click does —
   * a square rather than a rectangle, a round radius, an edge at a round
   * angle — so the preview has to follow the key, not just the pointer.
   */
  const shift = ref(false)
  let detachPointer: (() => void) | undefined

  function trackPointer(active: boolean) {
    const map = mapStore.getMapStrategy()?.mapInstance as
      | {
          on: (event: string, handler: (e: any) => void) => void
          off: (event: string, handler: (e: any) => void) => void
        }
      | undefined
    if (!map) return

    detachPointer?.()
    detachPointer = undefined
    cursor.value = null
    if (!active) return

    // rAF-coalesced: mousemove fires far faster than the map can redraw.
    let queued: Position | null = null
    let frame = 0
    const onMove = (event: {
      lngLat: { lng: number; lat: number }
      originalEvent?: { shiftKey?: boolean }
    }) => {
      queued = [event.lngLat.lng, event.lngLat.lat]
      // The pointer's own view of the modifier, in case a keyup landed
      // somewhere else while the window was unfocused.
      if (event.originalEvent) shift.value = !!event.originalEvent.shiftKey
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        cursor.value = queued
      })
    }
    const onOut = () => {
      cursor.value = null
    }

    const onDoubleClick = () => {
      if (!tool.value || TOOL_AUTOCOMPLETES[tool.value]) return
      // The second click of the double already added a vertex on top of the
      // one before it; drop the duplicate rather than committing a spur.
      const [a, b] = positions.value.slice(-2)
      if (a && b && a[0] === b[0] && a[1] === b[1]) {
        positions.value = positions.value.slice(0, -1)
      }
      if (canFinish.value) commit()
    }

    const onKey = (event: KeyboardEvent) => {
      shift.value = event.shiftKey
    }

    map.on('mousemove', onMove)
    map.on('mouseout', onOut)
    map.on('dblclick', onDoubleClick)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    detachPointer = () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('mousemove', onMove)
      map.off('mouseout', onOut)
      map.off('dblclick', onDoubleClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      shift.value = false
    }
  }

  // ── Route snapping ─────────────────────────────────────────────────────────
  //
  // The Route tool takes the same clicks as Line, then asks the routing engine
  // to follow the network between them — the same call the route builder uses,
  // via `lib/route-snapping`. The straight line shows until the path lands, so
  // the shape never blinks out while a request is in flight.

  const routeMode = ref<RouteMode>('walking')
  const routed = ref<CanvasAnnotation['routed'] | null>(null)
  const isSnapping = ref(false)
  let snapRequest: AbortController | undefined

  async function snapRoute() {
    if (tool.value !== 'route' || positions.value.length < 2) {
      routed.value = null
      return
    }

    snapRequest?.abort()
    const controller = new AbortController()
    snapRequest = controller
    isSnapping.value = true

    try {
      const path = await snapWaypointsToPath({
        waypoints: positions.value.map(([lng, lat]) => ({ lat, lng })),
        mode: routeMode.value,
        signal: controller.signal,
      })
      // A miss leaves the last good path in place: the straight fallback is
      // still drawn from the waypoints, so nothing is lost either way.
      if (path) {
        routed.value = {
          geometry: path.geometry,
          mode: routeMode.value,
          distance: path.stats.distance,
          duration: path.stats.duration,
        }
      }
    } catch (error) {
      if (!(error instanceof RouteSnapAborted)) {
        console.error('[canvas] failed to snap route', error)
      }
    } finally {
      if (snapRequest === controller) {
        isSnapping.value = false
        snapRequest = undefined
      }
    }
  }

  // ── Doodles ────────────────────────────────────────────────────────────────
  //
  // The only tool that draws by dragging rather than clicking, so it takes
  // the pointer directly instead of going through the map's click. The map's
  // own pan has to stand down for the length of the stroke, the way it does
  // for a handle being dragged.

  const doodleWidth = ref(DEFAULT_DOODLE_WIDTH)
  const isDoodling = ref(false)

  function doodlePosition(event: PointerEvent): Position | null {
    const map = mapStore.getMapStrategy()?.mapInstance as
      | {
          unproject?: (point: [number, number]) => { lng: number; lat: number }
          getCanvas?: () => HTMLCanvasElement
        }
      | undefined
    const canvas = map?.getCanvas?.()
    if (!map?.unproject || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { lng, lat } = map.unproject([
      event.clientX - rect.left,
      event.clientY - rect.top,
    ])
    return [lng, lat]
  }

  function onDoodleDown(event: PointerEvent) {
    if (tool.value !== 'doodle' || event.button !== 0) return
    const at = doodlePosition(event)
    if (!at) return

    event.preventDefault()
    event.stopPropagation()
    isDoodling.value = true
    positions.value = [at]
    setPanning(false)

    const canvas = (
      mapStore.getMapStrategy()?.mapInstance as
        | { getCanvas?: () => HTMLCanvasElement }
        | undefined
    )?.getCanvas?.()
    try {
      canvas?.setPointerCapture(event.pointerId)
    } catch {
      // Capture is a nicety; the window listeners are the guarantee.
    }
    window.addEventListener('pointermove', onDoodleMove)
    window.addEventListener('pointerup', onDoodleUp)
    window.addEventListener('pointercancel', onDoodleUp)
  }

  function onDoodleMove(event: PointerEvent) {
    if (!isDoodling.value) return
    const at = doodlePosition(event)
    if (at) positions.value = [...positions.value, at]
  }

  function onDoodleUp() {
    if (!isDoodling.value) return
    window.removeEventListener('pointermove', onDoodleMove)
    window.removeEventListener('pointerup', onDoodleUp)
    window.removeEventListener('pointercancel', onDoodleUp)
    isDoodling.value = false
    setPanning(true)

    // Tidy the stroke before it is kept: a hand leaves far more points than
    // the shape needs, and shakier ones than it meant.
    positions.value = smoothStroke(positions.value)
    if (canFinish.value) commit()
    else positions.value = []
  }

  /** The map's own drag has to stand down for the length of a stroke. */
  function setPanning(enabled: boolean) {
    const map = mapStore.getMapStrategy()?.mapInstance as
      | { dragPan?: { enable: () => void; disable: () => void } }
      | undefined
    if (enabled) map?.dragPan?.enable()
    else map?.dragPan?.disable()
  }

  function trackDoodle(active: boolean) {
    const canvas = (
      mapStore.getMapStrategy()?.mapInstance as
        | { getCanvas?: () => HTMLCanvasElement }
        | undefined
    )?.getCanvas?.()
    if (!canvas) return
    canvas.removeEventListener('pointerdown', onDoodleDown, true)
    if (active) canvas.addEventListener('pointerdown', onDoodleDown, true)
  }

  // ── Isochrones ─────────────────────────────────────────────────────────────
  //
  // One click sets an origin; the engine supplies the shape. The mark isn't
  // committed until it has one, so a canvas never holds an isochrone that is
  // only a point — the same reason a route keeps its waypoints.

  const isochroneMode = ref<IsochroneMode>('walk')
  const isochroneMinutes = ref(15)
  const isochrone = ref<CanvasAnnotation['isochrone'] | null>(null)
  const isFetchingIsochrone = ref(false)
  let isochroneRequest: AbortController | undefined

  async function requestIsochrone() {
    const origin = positions.value[0]
    if (tool.value !== 'isochrone' || !origin) return

    isochroneRequest?.abort()
    const controller = new AbortController()
    isochroneRequest = controller
    isFetchingIsochrone.value = true

    try {
      const { bands } = await fetchIsochroneBands({
        origin: { lng: origin[0], lat: origin[1] },
        mode: isochroneMode.value,
        // One contour: a mark is one shape, and bands would be several.
        durations: contourDurations(isochroneMinutes.value, 1),
        signal: controller.signal,
      })
      // The outermost band is the whole reachable area.
      const band = bands[bands.length - 1]
      const geometry = band?.geometry
      if (!geometry) return

      isochrone.value = {
        geometry:
          geometry.type === 'Polygon'
            ? geometry.coordinates
            : geometry.coordinates.flat(),
        mode: isochroneMode.value,
        minutes: isochroneMinutes.value,
      }
      commit()
    } catch (error) {
      if (!(error as Error)?.name?.includes('Abort')) {
        console.error('[canvas] failed to fetch an isochrone', error)
      }
      positions.value = []
    } finally {
      if (isochroneRequest === controller) {
        isFetchingIsochrone.value = false
        isochroneRequest = undefined
      }
    }
  }

  // A new origin, or a change of reach, asks the engine again.
  watch([positions, isochroneMode, isochroneMinutes], () => {
    if (tool.value === 'isochrone' && positions.value.length) {
      void requestIsochrone()
    }
  })

  // Re-snap on a new waypoint or a mode change, never on anything else.
  watch([positions, routeMode], () => {
    if (tool.value === 'route') void snapRoute()
  })

  /**
   * Screen distance between two positions, or null if the map can't say.
   * Snapping has to be judged in pixels: two points a metre apart are the
   * same click at one zoom and far apart at another.
   */
  function screenDistance(a: Position, b: Position): number | null {
    const map = mapStore.getMapStrategy()?.mapInstance as
      | { project?: (position: Position) => { x: number; y: number } }
      | undefined
    if (!map?.project) return null
    const from = map.project(a)
    const to = map.project(b)
    return Math.hypot(from.x - to.x, from.y - to.y)
  }

  /**
   * Whether the cursor is close enough to the first vertex to close the shape.
   *
   * Clicking back on the start is how everyone expects to finish a polygon,
   * and it is more discoverable than a double-click — which still works.
   */
  const snapToStart = computed(() => {
    if (tool.value !== 'polygon' || !cursor.value) return false
    if (positions.value.length < TOOL_MINIMUM.polygon) return false
    const distance = screenDistance(cursor.value, positions.value[0])
    return distance !== null && distance <= SNAP_PX
  })

  /**
   * Where the next click would actually land — after snapping to the start,
   * and after shift has constrained it.
   */
  const effectiveCursor = computed<Position | null>(() => {
    if (!tool.value || !cursor.value) return cursor.value
    if (snapToStart.value) return positions.value[0]
    if (!shift.value) return cursor.value
    return constrainPosition(tool.value, positions.value, cursor.value)
  })

  /**
   * The cursor says what the next click will do.
   *
   * `crosshair` for placing a point precisely, `copy` for the shapes that
   * add to something already started — one cursor for every tool told the
   * user nothing about which one they were in.
   */
  function applyCursor() {
    const canvas = (
      mapStore.getMapStrategy()?.mapInstance as
        | { getCanvas?: () => HTMLCanvasElement }
        | undefined
    )?.getCanvas?.()
    if (!canvas) return

    if (!tool.value) {
      canvas.style.cursor = ''
      return
    }
    // Over the vertex that would close the shape, say so: this click finishes
    // rather than adds.
    canvas.style.cursor = snapToStart.value
      ? 'pointer'
      : positions.value.length && tool.value !== 'pin'
        ? 'copy'
        : 'crosshair'
  }

  // The cursor tracks how far into a shape you are, and whether the next
  // click would close it.
  watch([positions, snapToStart], applyCursor)

  const isArmed = computed(() => tool.value !== null)
  const canFinish = computed(
    () => !!tool.value && isComplete(tool.value, positions.value.length),
  )
  const canUndo = computed(() => positions.value.length > 0)

  /**
   * The in-progress annotation, for the editor to draw as a preview. Null
   * until it has enough positions to be worth showing.
   */
  const draft = computed<CanvasAnnotation | null>(() => {
    if (!tool.value || !positions.value.length) return null

    // A rectangle's depth and a circle's radius are the last thing set, so
    // once the rest is clicked the cursor completes the real shape rather
    // than a guide standing in for it.
    const previewing =
      PREVIEW_AT[tool.value] === positions.value.length && effectiveCursor.value

    return {
      id: 'annotation-draft',
      tool: tool.value,
      positions: previewing
        ? [...positions.value, effectiveCursor.value!]
        : [...positions.value],
      color: color.value,
      ...(tool.value === 'route' && routed.value
        ? { routed: routed.value }
        : {}),
    }
  })

  /** The rubber band from the last vertex to where the click would land. */
  const guide = computed(() =>
    tool.value
      ? guideFeature(tool.value, positions.value, effectiveCursor.value)
      : null,
  )

  /**
   * What the overlay paints while a tool is armed. Null when nothing is, so
   * the overlay takes itself off the map.
   */
  const scene = computed<OverlayScene | null>(() => {
    if (!tool.value) return null
    return {
      shape: draft.value
        ? annotationFeature(draft.value, themeColorToHex)
        : null,
      color: themeColorToHex(color.value),
      guide: guide.value,
      pending: isSnapping.value || isFetchingIsochrone.value,
      width: tool.value === 'doodle' ? doodleWidth.value : undefined,
      handles: (tool.value === 'doodle' ? [] : positions.value).map((position, index) => ({
        position,
        kind: 'vertex' as const,
        // The vertex a click would close the shape on, ringed to say so.
        active: snapToStart.value && index === 0,
      })),
    }
  })

  function commit() {
    if (!tool.value || !canFinish.value) return
    // An isochrone is only a mark once the engine has answered for it.
    if (tool.value === 'isochrone' && !isochrone.value) return

    const annotation = createAnnotation(
      tool.value,
      [...positions.value],
      color.value,
      routed.value ?? undefined,
    )
    if (isochrone.value) annotation.isochrone = isochrone.value
    if (tool.value === 'doodle') annotation.width = doodleWidth.value
    options.onCommit(annotation)

    positions.value = []
    routed.value = null
    isochrone.value = null
  }


  function onMapClick(event: MapEvents['click']) {
    if (!tool.value) return

    // Back on the first vertex: that closes the shape rather than adding to it.
    if (snapToStart.value) {
      commit()
      return
    }

    const lngLat = event.lngLat as LngLat
    const at: Position = shift.value
      ? constrainPosition(tool.value, positions.value, [lngLat.lng, lngLat.lat])
      : [lngLat.lng, lngLat.lat]
    positions.value = [...positions.value, at]

    // Pins, rectangles and circles are finished the moment they have their
    // positions — there is nothing more to add, so committing keeps the tool
    // armed for the next one instead of asking for a press that means nothing.
    if (
      TOOL_AUTOCOMPLETES[tool.value] &&
      positions.value.length >= TOOL_MINIMUM[tool.value]
    ) {
      commit()
    }
  }

  function arm(next: AnnotationTool | null) {
    if (tool.value === next || !next) return disarm()
    // Both lean on the routing engine; neither works without one.
    if ((next === 'route' || next === 'isochrone') && !canRoute.value) return
    positions.value = []
    routed.value = null
    if (!tool.value) mapEventBus.setOverride('click', onMapClick)
    tool.value = next
    setDrawingMode(true)
    trackPointer(true)
    trackDoodle(next === 'doodle')
  }

  function disarm() {
    if (tool.value) mapEventBus.removeOverride('click', onMapClick)
    snapRequest?.abort()
    isochroneRequest?.abort()
    trackDoodle(false)
    onDoodleUp()
    tool.value = null
    positions.value = []
    routed.value = null
    isochrone.value = null
    trackPointer(false)
    setDrawingMode(false)
  }

  /** Finish an open-ended shape and stay on the tool. */
  function finish() {
    commit()
  }

  function undo() {
    positions.value = positions.value.slice(0, -1)
    if (positions.value.length < 2) routed.value = null
  }

  onScopeDispose(disarm)

  return {
    tool,
    color,
    routeMode,
    isSnapping,
    isArmed,
    canFinish,
    canUndo,
    canRoute,
    doodleWidth,
    isochroneMode,
    isochroneMinutes,
    isFetchingIsochrone,
    scene,
    vertexCount: computed(() => positions.value.length),
    arm,
    disarm,
    finish,
    undo,
  }
}
