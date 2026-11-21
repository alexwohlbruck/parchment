import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { requestBarrelman } from '../barrelman.service'
import { maxDurationForMode, type IsochroneMode, type IsochroneResponse } from '../../types/isochrone.types'
import type { LatLng } from '../../types/ask.types'
import { AskToolError, cached, type AskContext } from './ask-tool-base'

export function reachPolygon(
  from: LatLng,
  mode: IsochroneMode,
  minutes: number,
  context: AskContext,
): Promise<Feature<Polygon | MultiPolygon>> {
  return cached(
    'reach',
    { from, mode, minutes },
    { language: context.language },
    () => loadReachPolygon(from, mode, minutes),
  )
}

async function loadReachPolygon(
  from: LatLng,
  mode: IsochroneMode,
  minutes: number,
): Promise<Feature<Polygon | MultiPolygon>> {
  const seconds = Math.min(minutes * 60, maxDurationForMode(mode))
  const response = await requestBarrelman(
    '/isochrone',
    { lat: from.lat, lng: from.lng, mode, durations: seconds },
    { timeoutMs: 60_000 },
  )
  if (!response.ok)
    throw new AskToolError(`Could not compute reach (${response.status})`)
  const { isochrones } = (await response.json()) as IsochroneResponse
  const feature = isochrones?.features?.[0] as
    Feature<Polygon | MultiPolygon> | undefined
  if (!feature) throw new AskToolError('No reachable area')
  return feature
}
