import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

const GROUP = 'default:group:imagery'

/** Roughly the contiguous US, where NAIP and The National Map have coverage. */
const CONUS_BOUNDS = [-125, 24, -66, 50]

function imagery(
  key: string,
  name: string,
  order: number,
  source: Record<string, unknown>,
): DefaultLayerTemplate {
  const id = `imagery-${key}`
  return {
    templateId: `default:${id}`,
    name,
    type: LayerType.IMAGERY,
    engine: ['maplibre'],
    icon: 'SatelliteIcon',
    showInLayerSelector: false,
    visible: true,
    order,
    groupId: GROUP,
    isSubLayer: true,
    configuration: {
      id,
      type: 'raster',
      source: { id, type: 'raster', ...source },
    },
  }
}

export const IMAGERY_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  // Public domain, 0.3–0.6 m. An uncached image service that renders each tile
  // on request: exported at twice the tile size for high-DPI screens (larger
  // exports time out), and only from zoom 13, below which Sentinel-2 looks
  // much the same.
  imagery('usgs-naip', 'USGS NAIP', 0, {
    tiles: [
      'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image',
    ],
    tileSize: 256,
    minzoom: 13,
    maxzoom: 18,
    bounds: CONUS_BOUNDS,
    attribution: 'USGS The National Map, USDA NAIP',
  }),
  // Fills tiles outside its coverage with white rather than leaving them
  // empty, so it hides whatever sits below it in a stack.
  imagery('usgs', 'USGS Imagery', 1, {
    tiles: [
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 16,
    bounds: [-180, 17, -64, 72],
    attribution: 'USGS The National Map',
  }),
  // The 2016 mosaic is CC BY 4.0; later years are non-commercial only.
  imagery('s2cloudless', 'Sentinel-2 cloudless', 2, {
    tiles: [
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    ],
    tileSize: 256,
    maxzoom: 15,
    attribution:
      '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
  }),
  imagery('esri', 'Esri World Imagery', 3, {
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 19,
    attribution: '&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  }),
  imagery('esri-clarity', 'Esri Clarity', 4, {
    tiles: [
      'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 19,
    attribution: '&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  }),
]
