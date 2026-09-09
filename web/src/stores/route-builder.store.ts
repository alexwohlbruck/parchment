import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  RouteMode,
  RouteScheme,
  RouteWaypoint,
  RouteSegment,
  RouteStats,
} from '@/types/routes.types'

/**
 * Route builder state — the interactive "Create a Custom Route" canvas.
 *
 * Waypoints are the user's dropped points; `geometry`/`segments`/`stats` are
 * the snapped path the routing engine returns (set by the builder service,
 * which watches `waypoints` + `mode`).
 *
 * Undo/redo follows the standard past/present/future command-stack pattern.
 * Only the *user intent* (waypoints + mode) is journaled — the routed
 * geometry is derived and recomputed on demand, so it never enters history.
 * Every mutating action calls `record()` to snapshot the pre-mutation state
 * before applying its change, which clears the redo stack.
 */

interface BuilderSnapshot {
  waypoints: RouteWaypoint[]
  mode: RouteMode
}

const MAX_HISTORY = 100

export const useRouteBuilderStore = defineStore('route-builder', () => {
  // ── Session ────────────────────────────────────────────────────────────
  const isActive = ref(false)
  // Set when editing an existing saved route (vs creating a new one).
  const editingRouteId = ref<string | null>(null)
  const scheme = ref<RouteScheme>('server-key')
  // Read-only preview (detail view): line renders, markers are static, no
  // click-to-add. The detail view never attaches the map click listener.
  const readOnly = ref(false)

  // ── User intent (journaled) ──────────────────────────────────────────────
  const mode = ref<RouteMode>('walking')
  const waypoints = ref<RouteWaypoint[]>([])

  // ── Derived path (set by the builder service) ────────────────────────────
  const geometry = ref<Array<[number, number]>>([]) // [lng, lat]
  const elevation = ref<number[]>([]) // meters, aligned to geometry
  const segments = ref<RouteSegment[]>([])
  const stats = ref<RouteStats | null>(null)
  const isRouting = ref(false)
  const routeError = ref<string | null>(null)

  // ── History ──────────────────────────────────────────────────────────────
  const past = ref<BuilderSnapshot[]>([])
  const future = ref<BuilderSnapshot[]>([])

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)
  const hasWaypoints = computed(() => waypoints.value.length > 0)
  const canRoute = computed(() => waypoints.value.length >= 2)
  // The path already returns to its start. Out-&-back / close-loop are
  // no-ops here, so the UI disables them.
  const isClosedLoop = computed(() => {
    const w = waypoints.value
    if (w.length < 3) return false
    const f = w[0]
    const l = w[w.length - 1]
    return f.lat === l.lat && f.lng === l.lng
  })

  /**
   * Waypoints where the route reverses direction — the apex of an
   * out-&-back. Surfaced on the map as Apple-style turnaround badges.
   * A turn that bends back on itself (≥150°) counts as a reversal.
   */
  const turnarounds = computed<
    Array<{ lat: number; lng: number; index: number }>
  >(() => {
    const w = waypoints.value
    const out: Array<{ lat: number; lng: number; index: number }> = []
    const vec = (p: RouteWaypoint, q: RouteWaypoint): [number, number] => {
      const midLat = (((p.lat + q.lat) / 2) * Math.PI) / 180
      return [(q.lng - p.lng) * Math.cos(midLat), q.lat - p.lat]
    }
    const angle = (u: [number, number], v: [number, number]): number => {
      const mu = Math.hypot(u[0], u[1])
      const mv = Math.hypot(v[0], v[1])
      if (!mu || !mv) return 0
      const c = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (mu * mv)))
      return (Math.acos(c) * 180) / Math.PI
    }
    for (let i = 1; i < w.length - 1; i++) {
      if (angle(vec(w[i - 1], w[i]), vec(w[i], w[i + 1])) >= 150) {
        out.push({ lat: w[i].lat, lng: w[i].lng, index: i })
      }
    }
    return out
  })

  function snapshot(): BuilderSnapshot {
    return {
      waypoints: waypoints.value.map((w) => ({ ...w })),
      mode: mode.value,
    }
  }

  function apply(s: BuilderSnapshot) {
    waypoints.value = s.waypoints.map((w) => ({ ...w }))
    mode.value = s.mode
  }

  /** Snapshot current state onto the undo stack and clear redo. Call BEFORE mutating. */
  function record() {
    past.value.push(snapshot())
    if (past.value.length > MAX_HISTORY) past.value.shift()
    future.value = []
  }

  function undo() {
    if (!canUndo.value) return
    future.value.push(snapshot())
    apply(past.value.pop()!)
  }

  function redo() {
    if (!canRedo.value) return
    past.value.push(snapshot())
    apply(future.value.pop()!)
  }

  // ── Mutations (each records history) ─────────────────────────────────────
  function addWaypoint(wp: RouteWaypoint) {
    record()
    waypoints.value.push(wp)
  }

  function moveWaypoint(index: number, wp: RouteWaypoint) {
    if (index < 0 || index >= waypoints.value.length) return
    const last = waypoints.value.length - 1
    // On a closed loop the first and last waypoints are the same anchor.
    // Dragging either endpoint must move both so the loop stays closed.
    const f = waypoints.value[0]
    const l = waypoints.value[last]
    const wasLoop =
      waypoints.value.length >= 3 &&
      f.lat === l.lat &&
      f.lng === l.lng
    record()
    waypoints.value[index] = wp
    if (wasLoop && (index === 0 || index === last)) {
      const other = index === 0 ? last : 0
      waypoints.value[other] = { ...wp }
    }
  }

  function removeWaypoint(index: number) {
    if (index < 0 || index >= waypoints.value.length) return
    record()
    waypoints.value.splice(index, 1)
  }

  function removeLastWaypoint() {
    if (waypoints.value.length === 0) return
    record()
    waypoints.value.pop()
  }

  function clearWaypoints() {
    if (waypoints.value.length === 0) return
    record()
    waypoints.value = []
  }

  function setMode(m: RouteMode) {
    if (m === mode.value) return
    record()
    mode.value = m
  }

  /** Reverse the order of waypoints (start ↔ end). */
  function reverse() {
    if (waypoints.value.length < 2) return
    record()
    waypoints.value = [...waypoints.value].reverse()
  }

  /** Append a mirror of the path back to the start (A→B becomes A→B→A). */
  function outAndBack() {
    if (waypoints.value.length < 2) return
    record()
    const back = [...waypoints.value].slice(0, -1).reverse()
    waypoints.value = [...waypoints.value, ...back]
  }

  /** Close the loop by returning to the first waypoint. */
  function closeLoop() {
    if (waypoints.value.length < 2) return
    const first = waypoints.value[0]
    const last = waypoints.value[waypoints.value.length - 1]
    if (first.lat === last.lat && first.lng === last.lng) return
    record()
    waypoints.value = [...waypoints.value, { ...first }]
  }

  // ── Derived-path setters (no history) ────────────────────────────────────
  function setRouted(payload: {
    geometry: Array<[number, number]>
    elevation?: number[]
    segments: RouteSegment[]
    stats: RouteStats
  }) {
    geometry.value = payload.geometry
    elevation.value = payload.elevation ?? []
    segments.value = payload.segments
    stats.value = payload.stats
  }

  function clearRouted() {
    geometry.value = []
    elevation.value = []
    segments.value = []
    stats.value = null
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  function reset() {
    isActive.value = false
    editingRouteId.value = null
    readOnly.value = false
    scheme.value = 'server-key'
    mode.value = 'walking'
    waypoints.value = []
    clearRouted()
    past.value = []
    future.value = []
    isRouting.value = false
    routeError.value = null
  }

  /** Begin a fresh build session. */
  function start() {
    reset()
    isActive.value = true
  }

  /** Render a saved route read-only (detail view preview). */
  function preview(payload: {
    mode: RouteMode
    scheme: RouteScheme
    waypoints: RouteWaypoint[]
    geometry: Array<[number, number]>
    elevation?: number[]
    segments?: RouteSegment[]
    stats?: RouteStats | null
  }) {
    reset()
    isActive.value = true
    readOnly.value = true
    mode.value = payload.mode
    scheme.value = payload.scheme
    waypoints.value = payload.waypoints.map((w) => ({ ...w }))
    geometry.value = payload.geometry
    elevation.value = payload.elevation ?? []
    segments.value = payload.segments ?? []
    stats.value = payload.stats ?? null
  }

  /** Begin editing an existing saved route. */
  function startEditing(payload: {
    routeId: string
    mode: RouteMode
    scheme: RouteScheme
    waypoints: RouteWaypoint[]
    geometry: Array<[number, number]>
    elevation?: number[]
    segments?: RouteSegment[]
    stats?: RouteStats | null
  }) {
    reset()
    isActive.value = true
    editingRouteId.value = payload.routeId
    mode.value = payload.mode
    scheme.value = payload.scheme
    waypoints.value = payload.waypoints.map((w) => ({ ...w }))
    geometry.value = payload.geometry
    elevation.value = payload.elevation ?? []
    segments.value = payload.segments ?? []
    stats.value = payload.stats ?? null
  }

  return {
    // session
    isActive,
    editingRouteId,
    readOnly,
    scheme,
    // intent
    mode,
    waypoints,
    // derived
    geometry,
    elevation,
    segments,
    stats,
    isRouting,
    routeError,
    // history
    canUndo,
    canRedo,
    hasWaypoints,
    canRoute,
    isClosedLoop,
    turnarounds,
    undo,
    redo,
    // mutations
    addWaypoint,
    moveWaypoint,
    removeWaypoint,
    removeLastWaypoint,
    clearWaypoints,
    setMode,
    reverse,
    outAndBack,
    closeLoop,
    // derived setters
    setRouted,
    clearRouted,
    // lifecycle
    reset,
    start,
    startEditing,
    preview,
  }
})
