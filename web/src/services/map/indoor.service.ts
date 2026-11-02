/** Keeps the style's indoor state in step with the venues in view and the floor picked. */
import {
  gatePlate,
  INDOOR_GATE_PLATE,
  INDOOR_MINZOOM,
  INDOOR_SOURCE,
  INDOOR_STATE,
  INDOOR_VENUE_TILES,
} from '@/lib/map-style/indoor-layers'
import { clearedBuildings, focusedVenue, type IndoorFocus } from '@/lib/indoor/indoor-venue'

export function attachIndoor(
  map: any,
  on: { focus: (focus: IndoorFocus) => void; buildings: (refs: string[]) => void },
) {
  let enabled = true
  let queued = 0
  let focus: IndoorFocus = null
  let buildings = ''
  let venues: any[] = []
  /** The floor last picked in each venue, so panning away and back keeps it. */
  const picked = new Map<number, number>()

  function setState(key: string, value: unknown) {
    if (map.getGlobalState?.()[key] !== value) map.setGlobalStateProperty(key, value)
  }

  function apply(next: IndoorFocus) {
    const nextBuildings = clearedBuildings(venues, next)
    if (nextBuildings !== buildings) {
      buildings = nextBuildings
      setState(INDOOR_STATE.buildings, buildings)
      on.buildings(buildings.split(';').filter(Boolean))
    }
    setState(INDOOR_STATE.venue, next?.venue.id ?? 0)
    setState(INDOOR_STATE.level, next?.level ?? 0)
    const changed = next?.venue.id !== focus?.venue.id || next?.level !== focus?.level
    focus = next
    if (changed) on.focus(focus)
  }

  function update() {
    queued = 0
    if (!map.getSource(INDOOR_SOURCE)) return
    if (!enabled || map.getZoom() < INDOOR_MINZOOM) {
      venues = []
      return apply(null)
    }
    venues = map.querySourceFeatures(INDOOR_SOURCE, { sourceLayer: INDOOR_VENUE_TILES })
    const { lng, lat } = map.getCenter()
    const venue = focusedVenue(venues, [lng, lat])
    const level = venue ? picked.get(venue.id) ?? venue.defaultLevel : 0
    apply(venue ? { venue, level } : null)
  }

  const schedule = () => {
    if (!queued) queued = window.setTimeout(update, 120)
  }
  const onSourceData = (e: any) => {
    if (e.sourceId === INDOOR_SOURCE && e.tile) schedule()
  }
  const onStyleLoad = () => {
    focus = null
    buildings = ''
    schedule()
  }

  const onImageMissing = (e: { id: string }) => {
    if (e.id !== INDOOR_GATE_PLATE || map.hasImage(INDOOR_GATE_PLATE)) return
    const { image, options } = gatePlate(window.devicePixelRatio || 1)
    map.addImage(INDOOR_GATE_PLATE, image, options)
  }

  map.on('sourcedata', onSourceData)
  map.on('style.load', onStyleLoad)
  map.on('moveend', schedule)
  map.on('styleimagemissing', onImageMissing)

  return {
    setEnabled(value: boolean) {
      enabled = value
      update()
    },
    setLevel(level: number) {
      if (!focus) return
      picked.set(focus.venue.id, level)
      apply({ venue: focus.venue, level })
    },
    detach() {
      map.off('sourcedata', onSourceData)
      map.off('style.load', onStyleLoad)
      map.off('moveend', schedule)
      map.off('styleimagemissing', onImageMissing)
      if (queued) clearTimeout(queued)
    },
  }
}
