import { Layer, MaplibreLayer } from '@/types/map.types'

// List of Mapbox paint properties that are not supported by Maplibre
const MAPBOX_PAINT_PROPERTIES = [
  'fill-emissive-strength',
  'line-emissive-strength',
  'raster-emissive-strength',
  'icon-emissive-strength',
  'text-emissive-strength',
  'line-occlusion-opacity',
  'circle-emissive-strength',
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

export function parseMapboxToOsmId(featureId: string | number): {
  osmId: string
  poiType: 'node' | 'way' | 'relation' | 'unknown'
} {
  const typeCode = String(featureId).slice(-1)
  const osmId = String(featureId).slice(0, -1)

  const poiTypeCodeMap: {
    [key: string]: 'node' | 'way' | 'relation' | 'unknown'
  } = {
    '0': 'node',
    '1': 'way',
    '2': 'unknown',
    '3': 'unknown',
    '4': 'relation',
  }

  return {
    osmId,
    poiType: poiTypeCodeMap[typeCode] || 'unknown',
  }
}

interface OsmTags {
  [key: string]: string | undefined
}

export function getPlaceType(tags: OsmTags): string {
  // Helper to check if tag exists and matches value
  const hasTag = (key: string, value?: string) => {
    const tag = tags[key]
    return value ? tag === value : !!tag
  }

  // Check amenity tag first
  if (hasTag('amenity')) {
    const amenity = tags.amenity
    if (!amenity) return 'Place'

    switch (amenity) {
      case 'cafe':
        return hasTag('cuisine', 'coffee_shop') ? 'Coffee shop' : 'Café'
      case 'restaurant':
        if (!tags.cuisine) return 'Restaurant'
        const cuisineType = tags.cuisine.split(';')[0].replace('_', ' ')
        return `${cuisineType.charAt(0).toUpperCase()}${cuisineType.slice(
          1,
        )} restaurant`
      case 'bar':
        return 'Bar'
      case 'bank':
        return 'Bank'
      case 'pharmacy':
        return 'Pharmacy'
      case 'library':
        return 'Library'
      case 'school':
        return 'School'
      case 'hospital':
        return 'Hospital'
      default:
        return `${amenity.charAt(0).toUpperCase()}${amenity
          .slice(1)
          .replace('_', ' ')}`
    }
  }

  // Check shop tag
  if (hasTag('shop')) {
    const shop = tags.shop
    if (!shop) return 'Shop'
    return `${shop.charAt(0).toUpperCase()}${shop
      .slice(1)
      .replace('_', ' ')} shop`
  }

  // Check other common tags
  if (hasTag('tourism')) {
    const tourism = tags.tourism
    if (!tourism) return 'Tourist spot'
    return `${tourism.charAt(0).toUpperCase()}${tourism
      .slice(1)
      .replace('_', ' ')}`
  }

  if (hasTag('leisure')) {
    const leisure = tags.leisure
    if (!leisure) return 'Leisure venue'
    return `${leisure.charAt(0).toUpperCase()}${leisure
      .slice(1)
      .replace('_', ' ')}`
  }

  if (hasTag('office')) {
    const office = tags.office
    if (!office) return 'Office'
    return `${office.charAt(0).toUpperCase()}${office
      .slice(1)
      .replace('_', ' ')} office`
  }

  return 'Place' // Default fallback
}
