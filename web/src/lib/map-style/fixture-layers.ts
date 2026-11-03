/** Small square signs for what a person finds their way by: entrances, station stairs, lifts. */
import { DETAIL_SOURCE } from './detail-layers'

export const FIXTURE_LAYER = 'Fixtures'
export const FIXTURE_TILES = 'fixtures'

/** Style `state` key: `;`-delimited OSM ids of the fixtures a floor plan draws on their own level. */
export const INDOOR_FIXTURES_STATE = 'indoorFixtures'

/** The sprite's square badge for a glyph, in transit signage colours; `@token`s are resolved by `build.ts`. */
export const tileBadge = (art: unknown) => [
  'concat', 'poi|tile-', art,
  '|', '@poi_transit_plate', '|', '@poi_transit_ink', '|', '@poi_transit_ring', '|', '@poi_lift',
]

/** Asked of the detail bundle once it carries fixtures, past the day-long tile caches. */
export const withFixtures = (url: string) => `${url}${url.includes('?') ? '&' : '?'}fixtures=1`

const kind = ['get', 'kind']

/** Station entrances and lifts from street zoom; a building's own doors only once closer in. */
export function fixtureLayer(): any {
  return {
    id: FIXTURE_LAYER,
    type: 'symbol',
    source: DETAIL_SOURCE,
    'source-layer': FIXTURE_TILES,
    minzoom: 17,
    filter: [
      'all',
      ['any', ['!=', kind, 'entrance'], ['>=', ['zoom'], 18]],
      ['!', ['in', ['concat', ';', ['get', 'id'], ';'], ['global-state', INDOOR_FIXTURES_STATE]]],
    ],
    layout: {
      'icon-image': tileBadge(['match', kind, 'station_entrance', 'entrance', 'elevator', 'elevator', 'entrance-alt1']),
      'icon-size': ['interpolate', ['linear'], ['zoom'], 17, 0.66, 19, 0.8],
      'icon-padding': 2,
      'symbol-sort-key': ['match', kind, 'station_entrance', 0, 'elevator', 1, 2],
    },
  }
}
