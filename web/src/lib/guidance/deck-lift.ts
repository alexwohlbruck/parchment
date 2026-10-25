// How far above the ground the route runs where it crosses a 3D bridge deck,
// sampled once along the route so the puck can read it every frame.

import { bearingAt, pointAt, type NavRoute } from './nav-route'
import type { RouteSpan } from '@/lib/map-decks/deck.types'

/** Deck height under a point, in the terrain's metres; `along` picks the deck running that way. */
export type DeckHeight = (lng: number, lat: number, along?: [number, number]) => number | null
export type GroundHeight = (lng: number, lat: number) => number | null

export interface DeckProfile {
  step: number
  lift: Float32Array
}

export const DECK_STEP = 5
/** Metres past each end of a bridge the route reports that its deck may still carry it, as deck ends run on past the way. */
const BRIDGE_SLACK = 20

/**
 * Where the route may ride a deck: on the bridges it reports, and anywhere along a
 * segment whose edges say nothing of bridges, so a route under a deck stays down.
 */
export function bridgeSpans(route: NavRoute): RouteSpan[] {
  const spans: RouteSpan[] = []
  const add = (start: number, end: number) => {
    const last = spans.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else spans.push([start, end])
  }
  for (const segment of route.segments) {
    const edges = route.edges.filter(e => e.segmentIndex === segment.index)
    if (!edges.some(e => e.roadEnvironment)) add(segment.startDistance, segment.endDistance)
    else for (const e of edges) if (e.roadEnvironment === 'bridge') add(e.startDistance - BRIDGE_SLACK, e.endDistance + BRIDGE_SLACK)
  }
  return spans
}

export function ridesAt(spans: RouteSpan[], s: number): boolean {
  return spans.some(([start, end]) => s >= start && s <= end)
}

export function deckProfile(route: NavRoute, deckAt: DeckHeight, groundAt: GroundHeight, step = DECK_STEP): DeckProfile {
  const n = Math.max(1, Math.ceil(route.length / step) + 1)
  const lift = new Float32Array(n)
  const spans = bridgeSpans(route)
  for (let i = 0; i < n; i++) {
    const s = Math.min(route.length, i * step)
    if (!ridesAt(spans, s)) continue
    const p = pointAt(route, s)
    const rad = (bearingAt(route, s) * Math.PI) / 180
    // Mercator x runs east, y runs south.
    const deck = deckAt(p.lng, p.lat, [Math.sin(rad), -Math.cos(rad)])
    if (deck == null) continue
    lift[i] = Math.max(0, deck - (groundAt(p.lng, p.lat) ?? 0))
  }
  return { step, lift }
}

export function liftAt(profile: DeckProfile | null, s: number): number {
  if (!profile || profile.lift.length === 0) return 0
  const x = Math.max(0, s / profile.step)
  const i = Math.min(profile.lift.length - 1, Math.floor(x))
  const j = Math.min(profile.lift.length - 1, i + 1)
  const t = x - i
  return profile.lift[i] * (1 - t) + profile.lift[j] * t
}

/** Screen pixels a height `metres` tall appears at the puck, for a camera `pitchDeg` from straight down. */
export function liftPixels(metres: number, metresPerPixel: number, pitchDeg: number): number {
  if (metres <= 0 || metresPerPixel <= 0) return 0
  return (metres / metresPerPixel) * Math.sin((pitchDeg * Math.PI) / 180)
}
