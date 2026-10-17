import { FACADE_STYLE, FACADE_UNKNOWN } from '@/lib/map/facade-shader'

/** OSM `building` / `building:use` values, by the facade they wear. Anything else is guessed from height. */
const KINDS: Record<keyof typeof FACADE_STYLE, string[]> = {
  curtain: ['office', 'commercial', 'government', 'bank'],
  punched: ['apartments', 'residential', 'hotel', 'dormitory', 'hospital', 'university', 'college', 'school', 'flats'],
  shopfront: ['retail', 'supermarket', 'shop', 'mall', 'kiosk', 'restaurant'],
  industrial: ['industrial', 'warehouse', 'manufacture', 'factory', 'hangar', 'service', 'storage', 'depot'],
  parking: ['parking', 'multi-storey', 'garage_parking'],
  house: ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'cabin'],
  plain: [
    'church', 'cathedral', 'chapel', 'mosque', 'temple', 'synagogue', 'shrine', 'religious', 'civic', 'public',
    'train_station', 'transportation', 'stadium', 'grandstand', 'sports_hall', 'roof', 'shed', 'garage', 'garages',
    'hut', 'barn', 'farm_auxiliary', 'greenhouse', 'carport', 'ruins', 'construction', 'bridge', 'museum', 'theatre',
  ],
}

/**
 * The facade style id and a per-building seed as a colour, for
 * `BUILDING_3D_FACADE_LAYER`: red carries the id times 16 so it survives
 * MapLibre's colour packing exactly; green and blue carry the building's id,
 * which unlike anything geometric is the same in every zoom's tiles.
 */
export function buildingFacadeColor(): unknown {
  const key = ['floor', ['/', ['to-number', ['coalesce', ['get', 'group_id'], ['id']], 0], 10]]
  return [
    'let', 'key', key,
    ['rgb',
      ['*', 16, [
        'match', ['downcase', ['to-string', ['coalesce', ['get', 'kind'], '']]],
        ...Object.entries(KINDS).flatMap(([style, kinds]) => [kinds, FACADE_STYLE[style as keyof typeof FACADE_STYLE]]),
        FACADE_UNKNOWN,
      ]],
      ['%', ['var', 'key'], 256],
      ['%', ['floor', ['/', ['var', 'key'], 256]], 256]],
  ]
}
