// Owns the running GuidanceEngine. Renderers pull `sample()` once per frame;
// nothing here is reactive per frame.

import { readonly, shallowRef } from 'vue'
import { GuidanceEngine, type PuckState } from '@/lib/guidance/guidance-engine'
import type { NavRoute } from '@/lib/guidance/nav-route'
import { startPositionSource } from './position-source'

let engine: GuidanceEngine | null = null
let stopSource: (() => void) | null = null
let lastSample: { t: number; puck: PuckState | null } | null = null
const FRAME_SEC = 0.008
let frameIntervalMs = 0
let lastFrameMs = -Infinity
let frameDecision: { at: number; due: boolean } = { at: NaN, due: true }
const active = shallowRef(false)

function nowSec(): number {
  return Date.now() / 1000
}

export const guidanceEngine = {
  active: readonly(active),

  start(route: NavRoute): void {
    this.stop()
    const instance = new GuidanceEngine(route)
    engine = instance
    stopSource = startPositionSource({
      onFix: fix => instance.pushFix(fix, nowSec()),
      onMotion: sample => instance.pushMotion(sample),
    })
    active.value = true
  },

  stop(): void {
    stopSource?.()
    stopSource = null
    engine = null
    lastSample = null
    active.value = false
  },

  setRoute(route: NavRoute): void {
    engine?.setRoute(route)
  },

  hold(s: number | null): void {
    engine?.hold(s)
  },

  get holding(): boolean {
    return engine?.holding ?? false
  },

  /**
   * Whether the frame at `nowMs` should render. The puck and the camera both
   * ask, so on calm stretches they drop the same frames and never drift apart.
   */
  frameDue(nowMs: number): boolean {
    if (frameDecision.at === nowMs) return frameDecision.due
    const due = nowMs - lastFrameMs >= frameIntervalMs - 2
    if (due) lastFrameMs = nowMs
    frameDecision = { at: nowMs, due }
    return due
  },

  /** 0 renders every frame; ~33 halves the rate to 30 fps. */
  setFrameInterval(ms: number): void {
    frameIntervalMs = ms
  },

  /** Consumers in the same frame share one sample, so they never disagree. */
  sample(t = nowSec()): PuckState | null {
    if (!engine) return null
    if (lastSample && Math.abs(t - lastSample.t) < FRAME_SEC) return lastSample.puck
    const puck = engine.sample(t)
    lastSample = { t, puck }
    return puck
  },

  get route(): NavRoute | null {
    return engine?.navRoute ?? null
  },

  get diagnostics() {
    return engine?.diagnostics ?? null
  },
}
