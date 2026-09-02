/**
 * Reshaping a mark after it has been made.
 *
 * Selecting a mark puts handles on its joints: drag one to move it, drag a
 * midpoint to add one, double-click one to take it out. What moves is the
 * positions that were clicked, never the geometry they imply — so a rectangle
 * stays a rectangle when a corner moves, and a circle stays round.
 *
 * The drag is painted on the overlay rather than written to the canvas each
 * frame, and the mark is held out of the map's style for as long as it lasts,
 * so a reshape costs the style two updates: one when it starts, one when it
 * lands.
 */

import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { Position } from 'geojson'
import { useMapStore } from '@/stores/map.store'
import {
  RouteSnapAborted,
  snapWaypointsToPath,
} from '@/lib/route-snapping'
import { fetchIsochroneBands } from '@/lib/isochrone-request'
import { contourDurations } from '@/lib/isochrone.utils'
import type { IsochroneMode } from '@server/types/isochrone.types'
import type { CanvasAnnotation } from '@/types/canvas.types'
import type { OverlayHandle, OverlayScene } from '@/composables/useDrawOverlay'
import {
  distancePx,
  INSERT_THRESHOLD_PX,
  VERTEX_NEAR_PX,
} from '@/lib/measure.utils'
import {
  annotationFeature,
  annotationMidpoints,
  annotationNodes,
  annotationStyle,
  DEFAULT_ANNOTATION_COLOR,
  insertNode,
  moveNode,
  removeNode,
  type AnnotationNode,
} from '@/lib/canvas-annotations'
import { themeColorToHex } from '@/lib/utils'

/**
 * How close the pointer has to be to catch a handle. Shared with the measure
 * tool, so picking up a vertex feels the same wherever you do it — and a
 * midpoint is given a little more room, since it is a smaller target.
 */
const GRAB_PX = VERTEX_NEAR_PX
const MIDPOINT_GRAB_PX = INSERT_THRESHOLD_PX

interface EditableMap {
  project: (position: Position) => { x: number; y: number }
  unproject: (point: [number, number]) => { lng: number; lat: number }
  getCanvas: () => HTMLCanvasElement
  dragPan?: { enable: () => void; disable: () => void }
}

type Grab = AnnotationNode & { pointerId: number }

export function useAnnotationEditing(options: {
  annotations: Ref<CanvasAnnotation[]>
  selectedId: Ref<string | null>
  /** False while a drawing tool is armed — clicks belong to the tool then. */
  enabled: Ref<boolean>
  onChange: (id: string, patch: Partial<CanvasAnnotation>) => void
}) {
  const mapStore = useMapStore()

  /** The live position of the handle being dragged, before it is written. */
  const dragging = ref<Grab | null>(null)
  const dragPosition = ref<Position | null>(null)
  /** The handle under the pointer, so it can grow before it is grabbed. */
  const hovered = ref<number | null>(null)

  const selected = computed(
    () =>
      options.annotations.value.find(a => a.id === options.selectedId.value) ??
      null,
  )

  function mapInstance(): EditableMap | undefined {
    return mapStore.getMapStrategy()?.mapInstance as EditableMap | undefined
  }

  /** The mark as it looks right now, drag included. */
  const edited = computed<CanvasAnnotation | null>(() => {
    const annotation = selected.value
    if (!annotation) return null
    const grab = dragging.value
    if (!grab || !dragPosition.value) return annotation
    const moved = { ...annotation, ...moveNode(annotation, grab, dragPosition.value) }

    // An isochrone's shape comes from the engine, so a moved origin has no
    // new shape until it answers. Carrying the old one along under the
    // pointer is the honest preview: the right size, in the right place.
    if (moved.tool === 'isochrone' && moved.isochrone && annotation.positions[0]) {
      const [fromLng, fromLat] = annotation.positions[0]
      const [toLng, toLat] = dragPosition.value
      moved.isochrone = {
        ...moved.isochrone,
        geometry: moved.isochrone.geometry.map(ring =>
          ring.map(([lng, lat]) => [
            lng + (toLng - fromLng),
            lat + (toLat - fromLat),
          ]),
        ),
      }
    }
    return moved
  })

  const nodes = computed<AnnotationNode[]>(() =>
    edited.value ? annotationNodes(edited.value) : [],
  )
  const midpoints = computed(() =>
    // Adding a vertex mid-drag would fight the drag itself.
    edited.value && !dragging.value ? annotationMidpoints(edited.value) : [],
  )

  /**
   * What the overlay paints for a selected mark. Null unless there is one, so
   * a canvas with nothing selected costs nothing.
   */
  const scene = computed<OverlayScene | null>(() => {
    if (!options.enabled.value || !edited.value) return null
    // Resolved, not the palette's name for it: the overlay paints on a 2D
    // canvas, and `strokeStyle = 'ruby'` is silently ignored — which is how
    // a mark being dragged used to lose its colour.
    const color = themeColorToHex(edited.value.color ?? DEFAULT_ANNOTATION_COLOR)
    // What the map draws it as, so it doesn't change thickness on the way.
    const style = annotationStyle(edited.value, themeColorToHex)
    const handles: OverlayHandle[] = [
      ...nodes.value.map((node, index) => ({
        position: node.position,
        kind: node.kind === 'radius' ? ('radius' as const) : ('vertex' as const),
        active: hovered.value === index || dragging.value?.index === node.index,
      })),
      ...midpoints.value.map(midpoint => ({
        position: midpoint.position,
        kind: 'midpoint' as const,
      })),
    ]
    return {
      // Only drawn while the mark is held out of the style, so it isn't
      // painted twice.
      shape: dragging.value
        ? annotationFeature(edited.value, themeColorToHex)
        : null,
      color,
      width: style.strokeWidth,
      cap: style.strokeCap,
      guide: null,
      handles,
    }
  })

  /** The mark the map must not draw, because the overlay is drawing it. */
  const suppressedId = computed(() =>
    dragging.value ? (selected.value?.id ?? null) : null,
  )

  function pointToPosition(map: EditableMap, event: PointerEvent): Position {
    const rect = map.getCanvas().getBoundingClientRect()
    const { lng, lat } = map.unproject([
      event.clientX - rect.left,
      event.clientY - rect.top,
    ])
    return [lng, lat]
  }

  type Hit =
    | { kind: 'node'; node: AnnotationNode; nodeIndex: number }
    | { kind: 'midpoint'; midpoint: { index: number; position: Position } }

  /**
   * Which handle, if any, is within grabbing distance of a screen point.
   *
   * The nearest wins rather than the first found: handles can sit on top of
   * one another — a small circle's radius is barely off its centre — and
   * taking them in order would make one of them impossible to pick up.
   * Vertices are tried before midpoints, since a midpoint is only an offer.
   */
  function hitTest(map: EditableMap, x: number, y: number): Hit | null {
    const distance = (position: Position) =>
      distancePx(map.project(position), { x, y })

    let closest: { index: number; away: number } | null = null
    nodes.value.forEach((node, index) => {
      const away = distance(node.position)
      if (away <= GRAB_PX && (!closest || away < closest.away)) {
        closest = { index, away }
      }
    })
    if (closest) {
      const { index } = closest as { index: number }
      return { kind: 'node', node: nodes.value[index], nodeIndex: index }
    }

    const midpoint = midpoints.value.find(
      candidate => distance(candidate.position) <= MIDPOINT_GRAB_PX,
    )
    if (midpoint) return { kind: 'midpoint', midpoint }
    return null
  }

  function relative(map: EditableMap, event: PointerEvent) {
    const rect = map.getCanvas().getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function onPointerDown(event: PointerEvent) {
    if (!options.enabled.value || !selected.value) return
    const map = mapInstance()
    if (!map) return

    const { x, y } = relative(map, event)
    const hit = hitTest(map, x, y)
    if (!hit) return

    // The map would otherwise start panning under the drag.
    event.preventDefault()
    event.stopPropagation()
    map.dragPan?.disable()

    if (hit.kind === 'midpoint') {
      // Dragging a midpoint turns it into a real vertex, and then drags that.
      const annotation = selected.value
      options.onChange(
        annotation.id,
        insertNode(annotation, hit.midpoint.index, hit.midpoint.position),
      )
      dragging.value = {
        index: hit.midpoint.index,
        position: hit.midpoint.position,
        kind: 'vertex',
        pointerId: event.pointerId,
      }
      dragPosition.value = hit.midpoint.position
    } else {
      dragging.value = { ...hit.node, pointerId: event.pointerId }
      dragPosition.value = hit.node.position
    }

    map.getCanvas().style.cursor = 'grabbing'
    // Capture so the release still arrives if the pointer leaves the window
    // mid-drag. Without it a drag let go outside the page never ends, and the
    // mark stays held out of the style — invisible until the page reloads.
    try {
      map.getCanvas().setPointerCapture(event.pointerId)
    } catch {
      // Capture is a nicety; the window listeners below are the guarantee.
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('blur', endDrag)
  }

  function onPointerMove(event: PointerEvent) {
    const map = mapInstance()
    if (!map || !dragging.value) return
    if (event.pointerId !== dragging.value.pointerId) return
    dragPosition.value = pointToPosition(map, event)
  }

  /** Hovering a handle without pressing, so it can say it is grabbable. */
  function onHoverMove(event: PointerEvent) {
    if (dragging.value) return
    if (!options.enabled.value || !selected.value) {
      hovered.value = null
      return
    }
    const map = mapInstance()
    if (!map) return
    const { x, y } = relative(map, event)
    const hit = hitTest(map, x, y)
    const next = hit?.kind === 'node' ? hit.nodeIndex : null
    if (next === hovered.value && !hit) return
    hovered.value = next
    // A handle you can pick up should look like one.
    const canvas = map.getCanvas()
    if (hit) canvas.style.cursor = 'grab'
    else if (canvas.style.cursor === 'grab') canvas.style.cursor = ''
  }

  /** Put everything back, whether the drag finished or was taken away. */
  function endDrag(): { annotation: CanvasAnnotation; grab: Grab; to: Position } | null {
    const grab = dragging.value
    const map = mapInstance()
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('blur', endDrag)
    map?.dragPan?.enable()
    if (map) {
      map.getCanvas().style.cursor = ''
      if (grab) {
        try {
          map.getCanvas().releasePointerCapture(grab.pointerId)
        } catch {
          // Already released, or never captured.
        }
      }
    }

    const annotation = selected.value
    const to = dragPosition.value
    dragging.value = null
    dragPosition.value = null
    if (!grab || !annotation || !to) return null
    return { annotation, grab, to }
  }

  async function onPointerUp(event: PointerEvent) {
    if (!dragging.value || event.pointerId !== dragging.value.pointerId) return
    const finished = endDrag()
    if (!finished) return
    const { annotation, grab, to } = finished

    const patch = moveNode(annotation, grab, to)
    options.onChange(annotation.id, patch)

    // A route's path and an isochrone's reach both come from the engine, so
    // both have to be asked for again once their origin has moved.
    if (annotation.tool === 'route' && patch.positions) {
      await resnap({ ...annotation, ...patch })
    }
    if (annotation.tool === 'isochrone' && patch.positions) {
      await refetchIsochrone({ ...annotation, ...patch })
    }
  }

  /**
   * The reachable area for a moved origin.
   *
   * Until it lands the mark keeps the shape it had, which is wrong for the
   * new origin but better than blanking — the same reason a route holds its
   * old path while a new one is on the way.
   */
  async function refetchIsochrone(annotation: CanvasAnnotation) {
    const origin = annotation.positions[0]
    const previous = annotation.isochrone
    if (!origin || !previous) return

    snapRequest?.abort()
    const controller = new AbortController()
    snapRequest = controller
    try {
      const { bands } = await fetchIsochroneBands({
        origin: { lng: origin[0], lat: origin[1] },
        mode: previous.mode as IsochroneMode,
        durations: contourDurations(previous.minutes, 1),
        signal: controller.signal,
      })
      const geometry = bands[bands.length - 1]?.geometry
      if (!geometry) return
      options.onChange(annotation.id, {
        isochrone: {
          ...previous,
          geometry:
            geometry.type === 'Polygon'
              ? geometry.coordinates
              : geometry.coordinates.flat(),
        },
      })
    } catch (error) {
      if (!(error as Error)?.name?.includes('Abort')) {
        console.error('[canvas] failed to move an isochrone', error)
      }
    } finally {
      if (snapRequest === controller) snapRequest = undefined
    }
  }

  /** Double-clicking a vertex takes it out, if the shape can spare it. */
  function onDoubleClick(event: PointerEvent) {
    if (!options.enabled.value || !selected.value) return
    const map = mapInstance()
    if (!map) return
    const { x, y } = relative(map, event)
    const hit = hitTest(map, x, y)
    if (hit?.kind !== 'node' || hit.node.kind === 'radius') return

    const patch = removeNode(selected.value, hit.node.index)
    if (!patch) return
    event.preventDefault()
    event.stopPropagation()
    options.onChange(selected.value.id, patch)
    if (selected.value.tool === 'route') {
      void resnap({ ...selected.value, ...patch })
    }
  }

  let snapRequest: AbortController | undefined

  async function resnap(annotation: CanvasAnnotation) {
    snapRequest?.abort()
    const controller = new AbortController()
    snapRequest = controller
    try {
      const path = await snapWaypointsToPath({
        waypoints: annotation.positions.map(([lng, lat]) => ({ lat, lng })),
        mode: annotation.routed?.mode ?? 'walking',
        signal: controller.signal,
      })
      if (!path) return
      options.onChange(annotation.id, {
        routed: {
          geometry: path.geometry,
          mode: annotation.routed?.mode ?? 'walking',
          distance: path.stats.distance,
          duration: path.stats.duration,
        },
      })
    } catch (error) {
      if (!(error instanceof RouteSnapAborted)) {
        console.error('[canvas] failed to re-snap a route', error)
      }
    } finally {
      if (snapRequest === controller) snapRequest = undefined
    }
  }

  /**
   * Listening in the capture phase, on the container rather than the canvas:
   * the map's own drag handler is on the same element, and a handle has to
   * win the press before panning starts.
   */
  function listen(active: boolean) {
    const map = mapInstance()
    const canvas = map?.getCanvas()
    if (!canvas) return
    canvas.removeEventListener('pointerdown', onPointerDown, true)
    canvas.removeEventListener('pointermove', onHoverMove)
    canvas.removeEventListener('dblclick', onDoubleClick as EventListener, true)
    if (!active) return
    canvas.addEventListener('pointerdown', onPointerDown, true)
    canvas.addEventListener('pointermove', onHoverMove)
    canvas.addEventListener('dblclick', onDoubleClick as EventListener, true)
  }

  watch(
    () => options.enabled.value && !!selected.value,
    active => listen(active),
    { immediate: true },
  )

  onScopeDispose(() => {
    listen(false)
    snapRequest?.abort()
    endDrag()
  })

  return { scene, suppressedId, isDragging: computed(() => !!dragging.value) }
}
