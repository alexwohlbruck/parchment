/**
 * Data sources — the things layers are made from.
 *
 * A source describes where geospatial data lives; a layer is one rendering of
 * it on one canvas. Keeping them apart is what lets the same time zone
 * dataset be a filled choropleth on one canvas and a hairline outline on
 * another, and it is the shape Felt's "data sources" browser has.
 *
 * The global library below is hardcoded, the way default layer templates are:
 * these are curated datasets we know render well, not user content. Custom
 * sources (an uploaded file, a URL) are described by the same interface, so
 * everything downstream treats them identically.
 *
 * Database connectors are declared but not implemented — see
 * `DATABASE_CONNECTORS`. They are listed so the shape of the feature is
 * visible, and each one says plainly that it isn't available yet rather than
 * failing when clicked.
 */

import type { CanvasDataRender } from '@/types/canvas.types'

export type DataSourceKind = 'library' | 'file' | 'url' | 'database'

export interface DataSourceDefinition {
  id: string
  kind: DataSourceKind
  name: string
  /** One line, shown under the name in the browser. */
  description: string
  /** Who published it, shown as provenance. */
  provider: string
  /** Lucide icon name for the card when there's no thumbnail. */
  icon: string
  /**
   * What adding it produces. `style` sources are tiled and become a style
   * layer; `data` sources are GeoJSON and become a data layer with a render
   * mode.
   */
  layer:
    | { type: 'style'; configuration: Record<string, unknown> }
    | { type: 'data'; url: string; render: CanvasDataRender }
  /** Attribution string to carry onto the layer. */
  attribution?: string
}

/**
 * The global library. Every entry is a public, no-key endpoint — a source
 * that needs a token the instance may not have is worse than no source.
 */
export const GLOBAL_LIBRARY: DataSourceDefinition[] = [
  {
    id: 'timezones',
    kind: 'library',
    name: 'Time zones',
    description: 'The world’s time zone boundaries, as filled regions.',
    provider: 'Natural Earth',
    icon: 'ClockIcon',
    attribution: '© Natural Earth',
    layer: {
      type: 'data',
      url: 'https://raw.githubusercontent.com/evansiroky/timezone-boundary-builder/master/legacy/dist/combined-shapefile.json',
      render: 'shapes',
    },
  },
  {
    id: 'osm-raster',
    kind: 'library',
    name: 'OpenStreetMap',
    description: 'The standard OpenStreetMap raster tiles.',
    provider: 'OpenStreetMap',
    icon: 'MapIcon',
    attribution: '© OpenStreetMap contributors',
    layer: {
      type: 'style',
      configuration: {
        type: 'raster',
        source: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
    },
  },
  {
    id: 'opentopomap',
    kind: 'library',
    name: 'Topographic',
    description: 'Contours, relief shading and trails over OSM data.',
    provider: 'OpenTopoMap',
    icon: 'MountainIcon',
    attribution: '© OpenTopoMap (CC-BY-SA)',
    layer: {
      type: 'style',
      configuration: {
        type: 'raster',
        source: {
          type: 'raster',
          tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenTopoMap (CC-BY-SA)',
        },
      },
    },
  },
  {
    id: 'terrain-dem',
    kind: 'library',
    name: 'Elevation',
    description: 'Terrain elevation tiles, drawn as shaded relief.',
    provider: 'AWS Terrain Tiles',
    icon: 'MountainSnowIcon',
    attribution: 'Terrain data © Mapzen and contributors',
    layer: {
      type: 'style',
      configuration: {
        type: 'hillshade',
        source: {
          type: 'raster-dem',
          tiles: [
            'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          encoding: 'terrarium',
        },
      },
    },
  },
  {
    id: 'openrailwaymap',
    kind: 'library',
    name: 'Railways',
    description: 'Railway lines, stations and infrastructure.',
    provider: 'OpenRailwayMap',
    icon: 'TrainFrontIcon',
    attribution: '© OpenRailwayMap contributors',
    layer: {
      type: 'style',
      configuration: {
        type: 'raster',
        source: {
          type: 'raster',
          tiles: [
            'https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenRailwayMap contributors',
        },
      },
    },
  },
  {
    id: 'openseamap',
    kind: 'library',
    name: 'Nautical',
    description: 'Seamarks, buoys and navigation aids.',
    provider: 'OpenSeaMap',
    icon: 'AnchorIcon',
    attribution: '© OpenSeaMap contributors',
    layer: {
      type: 'style',
      configuration: {
        type: 'raster',
        source: {
          type: 'raster',
          tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenSeaMap contributors',
        },
      },
    },
  },
]

/**
 * Database connectors, declared but not built.
 *
 * These are the shape of "connect to a live source": a canvas layer that
 * queries a database and redraws as the data changes, rather than holding a
 * snapshot. Each is listed so the feature's outline is visible, and each is
 * marked unavailable so nothing pretends to work.
 */
export interface DatabaseConnector {
  id: string
  name: string
  description: string
  icon: string
  /** Always false for now — see the module header. */
  available: boolean
}

export const DATABASE_CONNECTORS: DatabaseConnector[] = [
  {
    id: 'postgres',
    name: 'Postgres',
    description: 'Query a PostGIS table and draw the result live.',
    icon: 'DatabaseIcon',
    available: false,
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    description: 'Draw the result of a BigQuery geography query.',
    icon: 'ChartColumnIcon',
    available: false,
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    description: 'Draw a Snowflake table with geography columns.',
    icon: 'SnowflakeIcon',
    available: false,
  },
]

export function findDataSource(id: string): DataSourceDefinition | undefined {
  return GLOBAL_LIBRARY.find(source => source.id === id)
}

/** Filter the library by a search term, over name, description and provider. */
export function searchLibrary(term: string): DataSourceDefinition[] {
  const query = term.trim().toLowerCase()
  if (!query) return GLOBAL_LIBRARY
  return GLOBAL_LIBRARY.filter(source =>
    [source.name, source.description, source.provider]
      .join(' ')
      .toLowerCase()
      .includes(query),
  )
}
