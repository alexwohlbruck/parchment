// The navigated route's height over the ground on 3D bridge decks, kept for
// the puck and camera to read each frame.

import { deckProfile, liftAt, type DeckProfile } from '@/lib/guidance/deck-lift'
import type { NavRoute } from '@/lib/guidance/nav-route'
import type { MapStrategy } from '@/services/map/providers/map.strategy'

const REBUILD_DELAY_MS = 400

let profile: DeckProfile | null = null

export function deckLiftAt(s: number): number {
  return liftAt(profile, s)
}

/** Samples the route against the decks now and whenever they change; returns a stop. */
export function trackDeckLift(map: MapStrategy, route: NavRoute): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const build = () => {
    timer = null
    profile = deckProfile(route, (lng, lat, along) => map.deckHeight(lng, lat, along), (lng, lat) => map.groundHeight(lng, lat))
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(build, REBUILD_DELAY_MS)
  }
  build()
  const unsubscribe = map.onDecksChanged(schedule)
  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
    profile = null
    map.liftCenter(0)
  }
}
