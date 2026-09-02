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
import { useDrawingSurface } from '@/composables/useDrawingSurface'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { themeColorToHex } from '@/lib/utils'
import type { OverlayScene } from '@/composables/useDrawOverlay'
import { snapWaypointsToPath } from '@/lib/route-snapping'
import { SUPERSEDED, useLatestRequest } from '@/composables/useLatestRequest'
import type { RouteMode } from '@/types/routes.types'
import type { IsochroneMode } from '@server/types/isochrone.types'
import { fetchIsochroneBands } from '@/lib/isochrone-request'
import { contourDurations } from '@/lib/isochrone.utils'
import type { LngLat, MapEvents } from '@/types/map.types'
import type {
  AnnotationTool,
  CanvasAnnotation,
  CanvasTool,
} from '@/types/canvas.types'
import {
  annotationFeature,
  annotationStyle,
  constrainPosition,
  smoothStroke,
  createAnnotation,
  guideFeature,
  isComplete,
  TOOL_AUTOCOMPLETES,
  TOOL_MINIMUM,
  DEFAULT_ANNOTATION_COLOR,
} from '@/lib/canvas-annotations'
import { drawStylePatch, type DrawStyle } from '@/lib/canvas-draw-style'

/** How close to the first vertex closing a shape starts to pull, in pixels. */
const SNAP_PX = 12

/** How far either side of the pointer the eraser reaches, in pixels. */
const ERASE_HIT_PX = 6

/** How many clicks a tool needs before the cursor completes its shape. */
const PREVIEW_AT: Partial<Record<AnnotationTool, number>> = {
  rectangle: 2,
  circle: 1,
}

export function useCanvasAnnotations(options: {
  /** Called with each finished annotation. */
  onCommit: (annotation: CanvasAnnotation) => void
  /**
   * Which of the ids under the pointer the eraser would remove — the map
   * hands back everything drawn there, basemap included, and only the canvas
   * knows which of them are its own marks.
   */
  eraseTarget: (ids: string[]) => string | null
  /** Remove that mark. */
  onErase: (id: string) => void
  /**
   * How the tool is set to draw — see `useCanvasDrawStyle`. A getter rather
   * than a value: the armed tool decides which settings apply, and it lives
   * here.
   */
  styleFor: (tool: AnnotationTool | null) => DrawStyle
}) {
  const mapToolsStore = useMapToolsStore()
  const surface = useDrawingSurface()
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

    // The tool needs the double-click and the shift key more than the map
    // does — see `setMapGestures`.
    surface.setMapGestures(!active)
    applyCursor()
  }

  const tool = ref<CanvasTool | null>(null)

  /**
   * The armed tool when it is one that draws — null while the eraser is in
   * hand, which is what keeps every drawing path below out of its way.
   */
  const drawing = computed<AnnotationTool | null>(() =>
    tool.value === 'erase' ? null : tool.value,
  )

  /** The armed tool's settings, and the same defaults the map draws with. */
  const style = computed(() => options.styleFor(drawing.value))
  const resolved = computed(() =>
    annotationStyle({ tool: drawing.value ?? 'line', ...style.value }),
  )
  const color = computed(() => style.value.color ?? DEFAULT_ANNOTATION_COLOR)
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
    const map = surface.map()
    if (!map?.on || !map.off) return

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
        if (tool.value === 'erase' && queued) {
          eraseTarget.value = markUnder(queued)
          applyCursor()
        }
      })
    }
    const onOut = () => {
      cursor.value = null
    }

    const onDoubleClick = () => {
      if (!drawing.value || TOOL_AUTOCOMPLETES[drawing.value]) return
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

    map.on('mousemove', onMove as never)
    map.on('mouseout', onOut as never)
    map.on('dblclick', onDoubleClick as never)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    detachPointer = () => {
      if (frame) cancelAnimationFrame(frame)
      map.off?.('mousemove', onMove as never)
      map.off?.('mouseout', onOut as never)
      map.off?.('dblclick', onDoubleClick as never)
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
  const snapping = useLatestRequest('failed to snap a route')

  async function snapRoute() {
    if (tool.value !== 'route' || positions.value.length < 2) {
      routed.value = null
      return
    }

    const mode = routeMode.value
    const path = await snapping.run(signal =>
      snapWaypointsToPath({
        waypoints: positions.value.map(([lng, lat]) => ({ lat, lng })),
        mode,
        signal,
      }),
    )
    // A miss leaves the last good path in place: the straight fallback is
    // still drawn from the waypoints, so nothing is lost either way. So does
    // an ask that a newer one replaced.
    if (!path || path === SUPERSEDED) return
    routed.value = {
      geometry: path.geometry,
      mode,
      distance: path.stats.distance,
      duration: path.stats.duration,
    }
  }

  // ── Doodles ────────────────────────────────────────────────────────────────
  //
  // The only tool that draws by dragging rather than clicking, so it takes
  // the pointer directly instead of going through the map's click. The map's
  // own pan has to stand down for the length of the stroke, the way it does
  // for a handle being dragged.

  const isDoodling = ref(false)

  function onDoodleDown(event: PointerEvent) {
    if (tool.value !== 'doodle' || event.button !== 0) return
    const at = surface.positionAt(event)
    if (!at) return

    event.preventDefault()
    event.stopPropagation()
    isDoodling.value = true
    positions.value = [at]
    surface.setPanning(false)

    try {
      surface.element()?.setPointerCapture(event.pointerId)
    } catch {
      // Capture is a nicety; the window listeners are the guarantee.
    }
    window.addEventListener('pointermove', onDoodleMove)
    window.addEventListener('pointerup', onDoodleUp)
    window.addEventListener('pointercancel', onDoodleUp)
  }

  function onDoodleMove(event: PointerEvent) {
    if (!isDoodling.value) return
    const at = surface.positionAt(event)
    if (at) positions.value = [...positions.value, at]
  }

  function onDoodleUp() {
    if (!isDoodling.value) return
    window.removeEventListener('pointermove', onDoodleMove)
    window.removeEventListener('pointerup', onDoodleUp)
    window.removeEventListener('pointercancel', onDoodleUp)
    isDoodling.value = false
    surface.setPanning(true)

    // Tidy the stroke before it is kept: a hand leaves far more points than
    // the shape needs, and shakier ones than it meant.
    positions.value = smoothStroke(positions.value)
    if (canFinish.value) commit()
    else positions.value = []
  }

  function trackDoodle(active: boolean) {
    const canvas = surface.element()
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
  const reaching = useLatestRequest('failed to fetch an isochrone')

  async function requestIsochrone() {
    const origin = positions.value[0]
    if (tool.value !== 'isochrone' || !origin) return

    const mode = isochroneMode.value
    const minutes = isochroneMinutes.value
    const answer = await reaching.run(signal =>
      fetchIsochroneBands({
        origin: { lng: origin[0], lat: origin[1] },
        mode,
        // One contour: a mark is one shape, and bands would be several.
        durations: contourDurations(minutes, 1),
        signal,
      }),
    )
    // Changing the mode or the reach asks again, and the ask it replaced
    // must leave the origin alone — dropping it there used to lose the mark
    // outright, since the answer still on its way had nothing to commit to.
    if (answer === SUPERSEDED) return
    if (!answer) {
      positions.value = []
      return
    }

    // The outermost band is the whole reachable area.
    const geometry = answer.bands[answer.bands.length - 1]?.geometry
    if (!geometry) return

    isochrone.value = {
      geometry:
        geometry.type === 'Polygon'
          ? geometry.coordinates
          : geometry.coordinates.flat(),
      mode,
      minutes,
    }
    commit()
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
   * Whether the cursor is close enough to the first vertex to close the shape.
   *
   * Clicking back on the start is how everyone expects to finish a polygon,
   * and it is more discoverable than a double-click — which still works.
   */
  const snapToStart = computed(() => {
    if (tool.value !== 'polygon' || !cursor.value) return false
    if (positions.value.length < TOOL_MINIMUM.polygon) return false
    const distance = surface.screenDistance(cursor.value, positions.value[0])
    return distance !== null && distance <= SNAP_PX
  })

  /**
   * Where the next click would actually land — after snapping to the start,
   * and after shift has constrained it.
   */
  const effectiveCursor = computed<Position | null>(() => {
    if (!drawing.value || !cursor.value) return cursor.value
    if (snapToStart.value) return positions.value[0]
    if (!shift.value) return cursor.value
    return constrainPosition(drawing.value, positions.value, cursor.value)
  })

  /**
   * The cursor says what the next click will do.
   *
   * `crosshair` throughout, because every click while a tool is armed places
   * a point precisely. Mid-shape used to show `copy`, which the browser
   * draws as an arrow with a green plus badge — a file-manager cursor that
   * says "drop a copy here", not "add a vertex". The one distinction worth
   * drawing is the click that *finishes*: over the vertex that would close
   * the shape, the cursor turns into a pointer.
   */
  function applyCursor() {
    if (!tool.value) {
      surface.setCursor('')
      return
    }
    // The eraser only does something over a mark, so it only offers there.
    const offering =
      tool.value === 'erase' ? !!eraseTarget.value : snapToStart.value
    surface.setCursor(offering ? 'pointer' : 'crosshair')
  }

  // The cursor tracks how far into a shape you are, and whether the next
  // click would close it.
  watch([positions, snapToStart], applyCursor)

  /**
   * The mark the eraser would take off, or null over bare map.
   *
   * The engine is asked what it drew at that point rather than the geometry
   * being hit-tested here: a mark is as thick as its stroke and as big as its
   * label, and only the thing that painted it knows that. Everything else
   * drawn there comes back too — basemap POIs, saved places — so the canvas
   * decides which of the ids are its own.
   */
  function markUnder(position: Position): string | null {
    // A box rather than a point: a hairline is otherwise almost unhittable.
    return options.eraseTarget(surface.idsAround(position, ERASE_HIT_PX))
  }

  /** What the eraser is over, for the cursor. */
  const eraseTarget = ref<string | null>(null)

  const isArmed = computed(() => tool.value !== null)
  const canFinish = computed(
    () => !!drawing.value && isComplete(drawing.value, positions.value.length),
  )
  const canUndo = computed(() => positions.value.length > 0)

  /**
   * The in-progress annotation, for the editor to draw as a preview. Null
   * until it has enough positions to be worth showing.
   */
  const draft = computed<CanvasAnnotation | null>(() => {
    if (!drawing.value || !positions.value.length) return null

    // A rectangle's depth and a circle's radius are the last thing set, so
    // once the rest is clicked the cursor completes the real shape rather
    // than a guide standing in for it.
    const previewing =
      PREVIEW_AT[drawing.value] === positions.value.length &&
      effectiveCursor.value

    return {
      id: 'annotation-draft',
      tool: drawing.value,
      positions: previewing
        ? [...positions.value, effectiveCursor.value!]
        : [...positions.value],
      ...drawStylePatch(drawing.value, { color: color.value, ...style.value }),
      ...(drawing.value === 'route' && routed.value
        ? { routed: routed.value }
        : {}),
    }
  })

  /** The rubber band from the last vertex to where the click would land. */
  const guide = computed(() =>
    drawing.value
      ? guideFeature(drawing.value, positions.value, effectiveCursor.value)
      : null,
  )

  /**
   * What the overlay paints while a tool is armed. Null when nothing is, so
   * the overlay takes itself off the map.
   */
  const scene = computed<OverlayScene | null>(() => {
    // Nothing to paint while erasing: the eraser takes marks off the map
    // rather than putting one on it.
    if (!drawing.value) return null
    return {
      shape: draft.value
        ? annotationFeature(draft.value, themeColorToHex)
        : null,
      color: themeColorToHex(color.value),
      guide: guide.value,
      pending: snapping.pending.value || reaching.pending.value,
      width: drawing.value === 'doodle' ? resolved.value.strokeWidth : undefined,
      cap: resolved.value.strokeCap,
      handles: (drawing.value === 'doodle' ? [] : positions.value).map((position, index) => ({
        position,
        kind: 'vertex' as const,
        // The vertex a click would close the shape on, ringed to say so.
        active: snapToStart.value && index === 0,
      })),
    }
  })

  function commit() {
    if (!drawing.value || !canFinish.value) return
    // An isochrone is only a mark once the engine has answered for it.
    if (drawing.value === 'isochrone' && !isochrone.value) return

    const annotation = createAnnotation(
      drawing.value,
      [...positions.value],
      style.value,
      routed.value ?? undefined,
    )
    if (isochrone.value) annotation.isochrone = isochrone.value
    options.onCommit(annotation)

    positions.value = []
    routed.value = null
    isochrone.value = null
  }


  function onMapClick(event: MapEvents['click']) {
    if (!tool.value) return

    if (tool.value === 'erase') {
      const lngLat = event.lngLat as LngLat
      const id = markUnder([lngLat.lng, lngLat.lat])
      if (id) options.onErase(id)
      return
    }
    if (!drawing.value) return

    // Back on the first vertex: that closes the shape rather than adding to it.
    if (snapToStart.value) {
      commit()
      return
    }

    const lngLat = event.lngLat as LngLat
    const at: Position = shift.value
      ? constrainPosition(drawing.value, positions.value, [
          lngLat.lng,
          lngLat.lat,
        ])
      : [lngLat.lng, lngLat.lat]
    positions.value = [...positions.value, at]

    // Pins, rectangles and circles are finished the moment they have their
    // positions — there is nothing more to add, so committing keeps the tool
    // armed for the next one instead of asking for a press that means nothing.
    if (
      TOOL_AUTOCOMPLETES[drawing.value] &&
      positions.value.length >= TOOL_MINIMUM[drawing.value]
    ) {
      commit()
    }
  }

  function arm(next: CanvasTool | null) {
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
    eraseTarget.value = null
    snapping.abort()
    reaching.abort()
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

  /**
   * The half-drawn state, for the editor's undo stack.
   *
   * A shape being drawn is as much a thing you can take back as a shape you
   * finished, so it belongs in the same history — see `useCanvasHistory`.
   * The tool comes along because positions without the tool that made them
   * describe nothing.
   */
  interface DrawingSnapshot {
    tool: CanvasTool | null
    positions: Position[]
    routed: CanvasAnnotation['routed'] | null
    isochrone: CanvasAnnotation['isochrone'] | null
  }

  function snapshot(): DrawingSnapshot {
    return {
      tool: tool.value,
      positions: positions.value,
      routed: routed.value ?? null,
      isochrone: isochrone.value ?? null,
    }
  }

  function restore(next: DrawingSnapshot) {
    // Arming does the map's side of the work — cursors, the click override,
    // the gestures that have to stand down — and clears positions, so the
    // state goes back on afterwards.
    if (next.tool !== tool.value) {
      if (next.tool) arm(next.tool)
      else disarm()
    }
    positions.value = next.positions
    routed.value = next.routed
    isochrone.value = next.isochrone
  }

  onScopeDispose(disarm)

  return {
    tool,
    routeMode,
    isSnapping: snapping.pending,
    isArmed,
    canFinish,
    canUndo,
    canRoute,
    snapshot,
    restore,
    // A stroke lays down a point per frame; history waits for it to finish.
    isBusy: isDoodling,
    isochroneMode,
    isochroneMinutes,
    isFetchingIsochrone: reaching.pending,
    scene,
    vertexCount: computed(() => positions.value.length),
    arm,
    disarm,
    finish,
    undo,
  }
}
