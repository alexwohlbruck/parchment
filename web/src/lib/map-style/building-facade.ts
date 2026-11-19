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

/** The facade style of each building, for `fill-extrusion-facade-style`: its kind's, or unknown for the shader to guess. */
export function buildingFacadeStyle(): unknown {
  return [
    'match', ['downcase', ['to-string', ['coalesce', ['get', 'kind'], '']]],
    ...Object.entries(KINDS).flatMap(([style, kinds]) => [kinds, FACADE_STYLE[style as keyof typeof FACADE_STYLE]]),
    FACADE_UNKNOWN,
  ]
}

/** A number per building for `fill-extrusion-facade-seed`: its id's low bits, which unlike anything geometric are the same in every zoom's tiles. */
export function buildingFacadeSeed(): unknown {
  return ['%', ['to-number', ['coalesce', ['get', 'group_id'], ['id']], 0], 65536]
}
