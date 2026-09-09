/**
 * Playback state for the GPX simulator. Plain JS, no Vue / no Pinia —
 * keeps the module fully decoupled. Subscribers (the UI panel and the
 * geolocation override) get notified when state changes.
 *
 * State machine: { stopped → playing ⇄ paused }. "Stopped" means no
 * track loaded OR loaded-but-reset; in either case the geolocation
 * override falls through to real GPS.
 */

import { pointAtTime, type GpxPoint } from './gpx-parser'

export type Status = 'stopped' | 'playing' | 'paused'

export interface SimulatorState {
  status: Status
  fileName: string | null
  points: GpxPoint[]
  /** Position in milliseconds since the start of the track. */
  trackTimeMs: number
  totalDurationMs: number
  playbackRate: number
  loop: boolean
  currentPoint: GpxPoint | null
}

type Listener = (state: SimulatorState) => void

const initialState: SimulatorState = {
  status: 'stopped',
  fileName: null,
  points: [],
  trackTimeMs: 0,
  totalDurationMs: 0,
  playbackRate: 1,
  loop: true,
  currentPoint: null,
}

let state: SimulatorState = { ...initialState }
const listeners = new Set<Listener>()

let rafId: number | null = null
let lastTickWallMs = 0

function emit() {
  for (const l of listeners) {
    try {
      l(state)
    } catch (err) {
      console.error('[gpx-sim] listener threw:', err)
    }
  }
}

function setState(patch: Partial<SimulatorState>) {
  state = { ...state, ...patch }
  emit()
}

function recomputeCurrentPoint() {
  if (state.points.length === 0) {
    state.currentPoint = null
    return
  }
  const startTime = state.points[0].time
  state.currentPoint = pointAtTime(state.points, startTime + state.trackTimeMs)
}

function tick() {
  rafId = requestAnimationFrame(tick)
  if (state.status !== 'playing') return

  const now = performance.now()
  const elapsedMs = (now - lastTickWallMs) * state.playbackRate
  lastTickWallMs = now

  let nextTime = state.trackTimeMs + elapsedMs
  if (nextTime >= state.totalDurationMs) {
    if (state.loop) {
      nextTime = nextTime % Math.max(1, state.totalDurationMs)
    } else {
      // Reached the end. Hold at the last point and pause.
      nextTime = state.totalDurationMs
      state = { ...state, trackTimeMs: nextTime, status: 'paused' }
      recomputeCurrentPoint()
      emit()
      return
    }
  }

  state = { ...state, trackTimeMs: nextTime }
  recomputeCurrentPoint()
  emit()
}

function ensureTickerRunning() {
  if (rafId == null) {
    lastTickWallMs = performance.now()
    rafId = requestAnimationFrame(tick)
  }
}

export const simulatorStore = {
  getState(): Readonly<SimulatorState> {
    return state
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    // Fire once with current state so subscribers can hydrate.
    try {
      fn(state)
    } catch (err) {
      console.error('[gpx-sim] subscriber init threw:', err)
    }
    return () => {
      listeners.delete(fn)
    }
  },

  load(fileName: string, points: GpxPoint[]) {
    if (points.length === 0) return
    const totalDurationMs =
      points[points.length - 1].time - points[0].time
    state = {
      ...state,
      status: 'paused',
      fileName,
      points,
      trackTimeMs: 0,
      totalDurationMs,
    }
    recomputeCurrentPoint()
    emit()
    ensureTickerRunning()
  },

  unload() {
    state = { ...initialState, playbackRate: state.playbackRate, loop: state.loop }
    emit()
  },

  play() {
    if (state.points.length === 0) return
    if (state.trackTimeMs >= state.totalDurationMs) {
      state = { ...state, trackTimeMs: 0 }
    }
    state = { ...state, status: 'playing' }
    lastTickWallMs = performance.now()
    emit()
    ensureTickerRunning()
  },

  pause() {
    if (state.status !== 'playing') return
    state = { ...state, status: 'paused' }
    emit()
  },

  stop() {
    state = { ...state, status: 'stopped', trackTimeMs: 0 }
    recomputeCurrentPoint()
    emit()
  },

  seek(ms: number) {
    const clamped = Math.max(0, Math.min(state.totalDurationMs, ms))
    state = { ...state, trackTimeMs: clamped }
    recomputeCurrentPoint()
    emit()
  },

  setRate(rate: number) {
    state = { ...state, playbackRate: Math.max(0.1, Math.min(64, rate)) }
    emit()
  },

  setLoop(loop: boolean) {
    state = { ...state, loop }
    emit()
  },
}

export type SimulatorStore = typeof simulatorStore
