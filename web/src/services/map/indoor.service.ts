/** Keeps the style's indoor state in step with the venues in view and the floor picked. */
import {
  gatePlate,
  INDOOR_GATE_PLATE,
  EXTERIOR_LEVEL,
  INDOOR_MINZOOM,
  INDOOR_SOURCE,
  INDOOR_STATE,
  INDOOR_VENUE_TILES,
} from '@/lib/map-style/indoor-layers'
import { BUILDING_3D_TILES } from '@/lib/map-style/detail-layers'
import { clearedBuildings, focusedVenue, openingLevel, type IndoorFocus } from '@/lib/indoor/indoor-venue'

export function attachIndoor(
  map: any,
  on: {
    focus: (focus: IndoorFocus) => void
    buildings: (refs: string[]) => void
    /** Whether a click on the map is free to open a venue, rather than wanted by a tool. */
    clickable: () => boolean
    /** Called when a click opened a venue, so nothing else answers it. */
    claimClick: () => void
  },
) {
  let enabled = true
  let queued = 0
  let focus: IndoorFocus = null
  let buildings = ''
  let venues: any[] = []
  /** The floor last picked in each venue, or null for its outside, so panning away and back keeps it. */
  const picked = new Map<number, number | null>()

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
    setState(INDOOR_STATE.level, next ? next.level ?? EXTERIOR_LEVEL : 0)
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
    const venue = focusedVenue(venues, [lng, lat], focusArea())
    apply(venue ? { venue, level: picked.has(venue.id) ? picked.get(venue.id)! : openingLevel(venue) } : null)
  }

  /** The middle half of the screen, as a ring on the ground. */
  function focusArea() {
    const { clientWidth: w, clientHeight: h } = map.getCanvas()
    return [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]
      .map(([x, y]) => map.unproject([x * w, y * h]))
      .map(({ lng, lat }: { lng: number; lat: number }) => [lng, lat])
  }

  /** The venue whose building a click landed on, from every venue in loaded tiles. */
  function venueAt(point: { x: number; y: number }) {
    const hits = map.queryRenderedFeatures(point)
    if (hits.some((f: any) => f.layer.type === 'symbol')) return null
    const building = hits.find((f: any) => f.layer['source-layer'] === BUILDING_3D_TILES)?.properties?.id
    if (!building) return null
    const all = map.querySourceFeatures(INDOOR_SOURCE, { sourceLayer: INDOOR_VENUE_TILES })
    const feature = all.find((f: any) => String(f.properties?.buildings ?? '').split(';').includes(building))
    return feature ? Number(feature.properties.venue) : null
  }

  // Clicking a building shown from outside takes you in: below plan zoom, by flying there.
  const onClick = (e: any) => {
    if (!enabled || !on.clickable()) return
    const below = map.getZoom() < INDOOR_MINZOOM
    if (!below && focus?.level !== null) return
    const venue = venueAt(e.point)
    if (venue === null || (!below && venue !== focus?.venue.id)) return
    on.claimClick()
    if (picked.get(venue) === null) picked.delete(venue)
    if (below) map.easeTo({ center: e.lngLat, zoom: INDOOR_MINZOOM + 1.5 })
    else update()
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
  map.on('click', onClick)

  return {
    setEnabled(value: boolean) {
      enabled = value
      update()
    },
    /** A level to show, or null for the venue's outside. */
    setLevel(level: number | null) {
      if (!focus) return
      picked.set(focus.venue.id, level)
      apply({ venue: focus.venue, level })
    },
    detach() {
      map.off('sourcedata', onSourceData)
      map.off('style.load', onStyleLoad)
      map.off('moveend', schedule)
      map.off('styleimagemissing', onImageMissing)
      map.off('click', onClick)
      if (queued) clearTimeout(queued)
    },
  }
}
