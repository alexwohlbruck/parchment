import { Layer, MaplibreLayer } from '@/types/map.types'

// List of Mapbox paint properties that are not supported by Maplibre
const MAPBOX_PAINT_PROPERTIES = [
  'fill-emissive-strength',
  'line-emissive-strength',
  'raster-emissive-strength',
  'icon-emissive-strength',
  'text-emissive-strength',
  'line-occlusion-opacity',
] as const

// List of Mapbox layout properties that are not supported by Maplibre
const MAPBOX_LAYOUT_PROPERTIES = [
  'symbol-placement',
  'text-field',
  'text-size',
  'text-offset',
  'text-font',
  'icon-image',
  'icon-size',
] as const

// TODO: Fix any types
export function mapboxLayerToMaplibreLayer(layer: Layer): MaplibreLayer {
  const { configuration } = { ...layer }
  const maplibreConfig: any = {
    ...configuration,
    type: configuration.type,
  }

  // Remove Mapbox-specific paint properties
  if (maplibreConfig.paint) {
    MAPBOX_PAINT_PROPERTIES.forEach(prop => {
      if (prop in maplibreConfig.paint) {
        delete maplibreConfig.paint[prop]
      }
    })
  }

  // Remove Mapbox-specific layout properties
  if (maplibreConfig.layout) {
    MAPBOX_LAYOUT_PROPERTIES.forEach(prop => {
      if (prop in maplibreConfig.layout) {
        delete maplibreConfig.layout[prop]
      }
    })
  }

  // Handle special source cases
  if (
    typeof maplibreConfig.source === 'string' &&
    maplibreConfig.source.startsWith('mapbox://')
  ) {
    ;(maplibreConfig as { [key: string]: any })['source'] = undefined
  }

  return {
    ...layer,
    configuration: maplibreConfig,
  } as any
}
