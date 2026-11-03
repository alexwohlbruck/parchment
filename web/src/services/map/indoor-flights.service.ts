/** Draws each venue's escalators and stairs as models, on their own layer so they never fade with the 3D objects. */
import { loadGlb, type GlbModel } from '@/lib/map-objects/glb.mjs'
import { ObjectLayer } from '@/lib/map-objects/object-layer'
import { INDOOR_FLIGHT_MODELS, INDOOR_FLIGHT_OBJECTS, INDOOR_FLIGHT_PALETTE } from '@/lib/map-objects/indoor-flights'
import { INDOOR_FIXTURE_LAYER } from '@/lib/map-style/indoor-layers'
import type { FlavorId } from '@/lib/map-style/build'

const LAYER_ID = 'indoor-flights'

export function attachIndoorFlights(map: any, flavor: () => FlavorId) {
  let enabled = true
  let layer: ObjectLayer | null = null
  let models: Promise<Record<string, GlbModel>> | null = null

  const ready = () => enabled && !map.getLayer(LAYER_ID) && !!map.getLayer(INDOOR_FIXTURE_LAYER)

  async function add() {
    if (!ready()) return
    models ??= Promise.all(
      Object.entries(INDOOR_FLIGHT_MODELS).map(async ([name, url]) => [name, await loadGlb(url)] as const),
    ).then(entries => Object.fromEntries(entries))
    let loaded: Record<string, GlbModel>
    try {
      loaded = await models
    } catch (error) {
      console.error('Indoor flights: could not load models', error)
      models = null
      return
    }
    if (!ready()) return
    layer = new ObjectLayer([INDOOR_FLIGHT_OBJECTS], loaded, INDOOR_FLIGHT_PALETTE[flavor()], { id: LAYER_ID })
    // Under the badges: a symbol ignores depth, so only drawing first keeps a flight off its own sign.
    map.addLayer(layer, INDOOR_FIXTURE_LAYER)
  }

  function remove() {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
    layer = null
  }

  const onStyle = () => {
    if (!map.getLayer(LAYER_ID)) layer = null
    layer?.setFlavor(INDOOR_FLIGHT_PALETTE[flavor()])
    add()
  }
  map.on('style.load', onStyle)
  add()

  return {
    /** Places the flights again for the floors now showing. */
    refresh: () => layer?.refresh(),
    setEnabled(value: boolean) {
      enabled = value
      if (value) add()
      else remove()
    },
    detach() {
      map.off('style.load', onStyle)
      remove()
    },
  }
}
