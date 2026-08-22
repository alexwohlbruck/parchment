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
import {
  RouteSnapAborted,
  snapWaypointsToPath,
} from '@/lib/route-snapping'
import type { RouteMode } from '@/types/routes.types'
import type { LngLat, MapEvents } from '@/types/map.types'
import type { AnnotationTool, CanvasAnnotation } from '@/types/canvas.types'
import {
  createAnnotation,
  guideFeature,
  isComplete,
  TOOL_AUTOCOMPLETES,
  TOOL_MINIMUM,
  DEFAULT_ANNOTATION_COLOR,
} from '@/lib/canvas-annotations'

export function useCanvasAnnotations(options: {
  /** Called with each finished annotation. */
  onCommit: (annotation: CanvasAnnotation) => void
}) {
  const mapStore = useMapStore()
  const mapToolsStore = useMapToolsStore()

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

    const map = mapStore.getMapStrategy()?.mapInstance as
      | {
          doubleClickZoom?: { enable: () => void; disable: () => void }
          getCanvas?: () => HTMLCanvasElement
        }
      | undefined
    if (!map) return
    if (active) map.doubleClickZoom?.disable()
    else map.doubleClickZoom?.enable()
    applyCursor()
  }

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
    canvas.style.cursor =
      positions.value.length && tool.value !== 'pin' ? 'copy' : 'crosshair'
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
    const onMove = (event: { lngLat: { lng: number; lat: number } }) => {
      queued = [event.lngLat.lng, event.lngLat.lat]
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

    map.on('mousemove', onMove)
    map.on('mouseout', onOut)
    map.on('dblclick', onDoubleClick)
    detachPointer = () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('mousemove', onMove)
      map.off('mouseout', onOut)
      map.off('dblclick', onDoubleClick)
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

  // Re-snap on a new waypoint or a mode change, never on anything else.
  watch([positions, routeMode], () => {
    if (tool.value === 'route') void snapRoute()
  })

  // The cursor tracks how far into a shape you are.
  watch(positions, applyCursor)

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

    // A rectangle and a circle are fully described by their first position
    // plus the cursor, so they preview as the real shape rather than a guide.
    const previewing =
      (tool.value === 'rectangle' || tool.value === 'circle') &&
      positions.value.length === 1 &&
      cursor.value

    return {
      id: 'annotation-draft',
      tool: tool.value,
      positions: previewing
        ? [positions.value[0], cursor.value!]
        : [...positions.value],
      color: color.value,
      ...(tool.value === 'route' && routed.value
        ? { routed: routed.value }
        : {}),
    }
  })

  /** The rubber band from the last vertex to the cursor. */
  const guide = computed(() =>
    tool.value ? guideFeature(tool.value, positions.value, cursor.value) : null,
  )

  function commit() {
    if (!tool.value || !canFinish.value) return
    options.onCommit(
      createAnnotation(
        tool.value,
        [...positions.value],
        color.value,
        routed.value ?? undefined,
      ),
    )
    positions.value = []
    routed.value = null
  }


  function onMapClick(event: MapEvents['click']) {
    if (!tool.value) return
    const lngLat = event.lngLat as LngLat
    positions.value = [...positions.value, [lngLat.lng, lngLat.lat]]

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
    positions.value = []
    routed.value = null
    if (!tool.value) mapEventBus.setOverride('click', onMapClick)
    tool.value = next
    setDrawingMode(true)
    trackPointer(true)
  }

  function disarm() {
    if (tool.value) mapEventBus.removeOverride('click', onMapClick)
    snapRequest?.abort()
    tool.value = null
    positions.value = []
    routed.value = null
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
    guide,
    routeMode,
    isSnapping,
    isArmed,
    canFinish,
    canUndo,
    draft,
    vertexCount: computed(() => positions.value.length),
    arm,
    disarm,
    finish,
    undo,
  }
}
