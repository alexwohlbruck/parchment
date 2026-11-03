/**
 * Nets, hoops and goals, from the props barrelman places on each court and field
 * it lays out (`sport_pitches`). They arrive facing the court, and a net or goal
 * carries the width it spans.
 */
import { DETAIL_SOURCE, PITCH_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'
import { bearingOf } from './furniture'
import { tagged } from './vary'

export const SPORT_MODELS = {
  'tennis-net': '/models/tennis-net.glb',
  'pickleball-net': '/models/pickleball-net.glb',
  'volleyball-net': '/models/volleyball-net.glb',
  'basketball-hoop': '/models/basketball-hoop.glb',
  'soccer-goal': '/models/soccer-goal.glb',
  'football-goalpost': '/models/football-goalpost.glb',
}

type SportModel = keyof typeof SPORT_MODELS

/** Real heights, in metres. */
const HEIGHT: Record<SportModel, number> = {
  'tennis-net': 1.07,
  'pickleball-net': 0.92,
  'volleyball-net': 2.55,
  'basketball-hoop': 3.95,
  'soccer-goal': 2.5,
  'football-goalpost': 12.2,
}

export function sportPropInstance(feature: any, lng: number, lat: number): ObjectInstance | null {
  const props = feature.properties ?? {}
  if (!(props.kind in SPORT_MODELS)) return null
  const model = props.kind as SportModel
  const heading = bearingOf(props.direction)
  if (heading === null) return null

  const width = tagged(props.width, 0.5, 30)
  return {
    lng,
    lat,
    height: HEIGHT[model],
    spread: HEIGHT[model],
    ...(width === null ? {} : { width }),
    heading,
    shade: 1,
    model,
  }
}

export const SPORT_OBJECTS: ObjectSourceSpec = {
  source: DETAIL_SOURCE,
  sourceLayer: PITCH_TILES,
  minzoom: 16,
  toInstance: sportPropInstance,
}
