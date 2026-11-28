/** Feeds the flat golf pin layer one flag per green, from whichever detail tiles are loaded. */
import { frameTask } from '@/lib/map/rendering/frame-task'
import { sourceFeatureSteps } from '@/lib/map/source-features'
import { DETAIL_SOURCE, GOLF_PIN_SOURCE, GOLF_TILES } from '@/lib/map-style/detail-layers'
import { golfPinSites } from '@/lib/map-objects/golf'

export function attachGolfPins(map: any) {
  let queued = 0
  let signature = ''

  function* pin(): Generator<void> {
    const source = map.getSource(GOLF_PIN_SOURCE)
    if (!source || !map.getSource(DETAIL_SOURCE)) return
    const sites = golfPinSites(yield* sourceFeatureSteps(map, DETAIL_SOURCE, GOLF_TILES))
    const next = sites.map(s => `${s.key}@${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).sort().join('|')
    if (next === signature) return
    signature = next
    source.setData({
      type: 'FeatureCollection',
      features: sites.map(s => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    })
  }

  const pinning = frameTask(pin)
  const update = () => {
    queued = 0
    pinning.request()
  }
  const schedule = () => {
    if (!queued) queued = window.setTimeout(update, 150)
  }
  const onSourceData = (e: any) => {
    if (e.sourceId === DETAIL_SOURCE && e.tile) schedule()
  }
  // A style swap brings an empty source back, whatever the tiles still hold.
  const onStyleLoad = () => {
    signature = ''
    schedule()
  }

  map.on('sourcedata', onSourceData)
  map.on('style.load', onStyleLoad)
  map.on('moveend', schedule)

  return {
    detach() {
      map.off('sourcedata', onSourceData)
      map.off('style.load', onStyleLoad)
      map.off('moveend', schedule)
      if (queued) clearTimeout(queued)
      pinning.cancel()
    },
  }
}
