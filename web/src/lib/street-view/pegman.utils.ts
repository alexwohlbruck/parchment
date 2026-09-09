import { LngLat, Pegman } from '@/types/map.types'
import { FeatureCollection, Feature, Point, Polygon } from 'geojson'

export function getDestinationPoint(
  center: [number, number],
  radius: number,
  bearing: number,
): [number, number] {
  const bearingRad = (bearing * Math.PI) / 180
  const lat1 = (center[1] * Math.PI) / 180
  const lon1 = (center[0] * Math.PI) / 180

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(radius) +
      Math.cos(lat1) * Math.sin(radius) * Math.cos(bearingRad),
  )

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(radius) * Math.cos(lat1),
      Math.cos(radius) - Math.sin(lat1) * Math.sin(lat2),
    )

  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]
}

// TODO: Clean up
export function createPegmanLayers(map: any, mapbox: boolean) {
  // Add source for pegman position and FOV
  map.addSource('pegman', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [],
    },
  })

  // Position dot
  const positionPaint = {
    'circle-radius': 6,
    'circle-color': '#4285F4',
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  }
  if (mapbox) {
    positionPaint['circle-emissive-strength'] = 1
  }
  map.addLayer({
    id: 'pegman-position',
    type: 'circle',
    source: 'pegman',
    paint: positionPaint,
    filter: ['==', '$type', 'Point'],
  })

  // FOV cone
  const fovPaint = {
    'fill-color': '#4285F4',
    'fill-opacity': 0.2,
  }
  if (mapbox) {
    fovPaint['fill-emissive-strength'] = 1
  }
  map.addLayer({
    id: 'pegman-fov',
    type: 'fill',
    source: 'pegman',
    paint: fovPaint,
    filter: ['==', '$type', 'Polygon'],
  })
}

export function updatePegmanData(pegman: Pegman): FeatureCollection {
  if (!pegman.visible) {
    return {
      type: 'FeatureCollection',
      features: [],
    } as FeatureCollection
  }

  const { position, pov, fov } = pegman
  const bearing = pov.bearing
  const radius = 0.00001
  const center: [number, number] = [position.lng, position.lat]

  const numPoints = 16
  const startAngle = bearing - fov / 2
  const endAngle = bearing + fov / 2
  const arcPoints: [number, number][] = []

  arcPoints.push(center)

  for (let i = 0; i <= numPoints; i++) {
    const angle = startAngle + (i / numPoints) * (endAngle - startAngle)
    arcPoints.push(getDestinationPoint(center, radius, angle))
  }

  arcPoints.push(center)

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: center,
        },
        properties: {},
      } as Feature<Point>,
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [arcPoints],
        },
        properties: {},
      } as Feature<Polygon>,
    ],
  }
}
