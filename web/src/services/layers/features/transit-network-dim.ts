/**
 * Transit Network Dim
 *
 * Steps the transit network back so one thing on top of it — an isolated
 * line, or an itinerary's own polyline — reads as the subject. Dimmed
 * rather than hidden: a line followed through a city still belongs to
 * that city, and the ribbons it crosses are what make the next transfer
 * visible.
 *
 * One dimmer for the whole map. Two of them would each record the other's
 * faded paint as the value to restore, and the network would never come
 * back.
 */

import { networkDim } from '@/services/layers/features/portolan/portolan-isolation-tuning'

/** Transitland layer IDs that should be faded (retired from the default
 *  template — kept for user-cloned copies still on the map). Excludes
 *  `transitland-route-active` — it's a hover utility layer with a
 *  feature-state opacity expression that breaks if overridden flat.
 *  Portolan layers are NOT listed: they're enumerated live off the style
 *  by their `portolan-` prefix, since the set (per-feed, per-band) is
 *  dynamic. */
const TRANSIT_LAYER_IDS = [
  'transitland-rail',
  'transitland-rail-outline',
  'transitland-bus-low',
  'transitland-bus-low-outline',
  'transitland-bus-medium',
  'transitland-bus-medium-outline',
  'transitland-tram',
  'transitland-tram-outline',
  'transitland-metro',
  'transitland-metro-outline',
  'transitland-other',
  'transitland-other-outline',
  'transitland-tram-labels',
  'transitland-metro-labels',
  'transitland-rail-labels',
  'transitland-bus-medium-labels',
  'transitland-other-labels',
  'transitland-stops',
  'transitland-stops-labels',
]

/** Theme-dependent because the same alpha buys far less contrast against a
 *  near-black basemap: a dim that reads as "stepped back" in daylight reads
 *  as "gone" at night. */
export const networkDimOpacity = () =>
  networkDim(document.documentElement.classList.contains('dark'))

/** Which opacity paint props carry a layer type's fade. */
const OPACITY_PROPS: Record<string, string[]> = {
  line: ['line-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
}

/** Opacity paints recorded before fading, keyed `layerId|prop`. The
 *  portolan ribbons carry opacity EXPRESSIONS (per-feed style manifests),
 *  so restore must put back exactly what was there — resetting to null
 *  would flatten them to the spec default. */
const savedOpacity = new Map<string, unknown>()

/** Every layer the dim touches: the (retired) transitland ids that may
 *  survive as user clones, plus every portolan layer in the current
 *  style, enumerated by prefix — the set is per-feed and per-band. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dimTargetLayerIds(map: any): string[] {
  const ids = [...TRANSIT_LAYER_IDS]
  try {
    for (const layer of map?.getStyle()?.layers ?? []) {
      if (layer.id.startsWith('portolan-')) ids.push(layer.id)
    }
  } catch {
    // style not ready — the transitland list still applies
  }
  return ids
}

/**
 * Fade the network to `opacity`, or restore it with null.
 *
 * `skipPortolan` is for the case where portolan's own ribbons ARE the
 * highlight: dimming them would dim the very line being shown.
 */
export function fadeTransitNetwork(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any,
  opacity: number | null,
  { skipPortolan = false }: { skipPortolan?: boolean } = {},
) {
  if (!map) return

  for (const layerId of dimTargetLayerIds(map)) {
    if (skipPortolan && layerId.startsWith('portolan-')) continue
    try {
      const layer = map.getLayer(layerId)
      if (!layer) continue

      for (const prop of OPACITY_PROPS[layer.type] ?? []) {
        const key = `${layerId}|${prop}`
        if (opacity === null) {
          map.setPaintProperty(layerId, prop, savedOpacity.get(key) ?? null)
        } else {
          if (!savedOpacity.has(key)) {
            savedOpacity.set(key, map.getPaintProperty(layerId, prop))
          }
          map.setPaintProperty(layerId, prop, opacity)
        }
      }
    } catch {
      // Layer might not exist in the current map style
    }
  }

  if (opacity === null) savedOpacity.clear()
}
