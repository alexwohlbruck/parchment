import type { CanvasBody, CanvasDataLayer } from '../../schema/canvases.schema'
import type { LatLng } from '../../types/ask.types'

export interface CanvasPoint extends LatLng {
  name: string
  placeId?: string
  type?: string
}

export interface CanvasPlaceGroup {
  name: string
  color?: string
  places: CanvasPoint[]
}

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#db2777']
const HEX = /^#[0-9a-f]{6}$/i
const WORLD_DEGREES = 360
const MIN_ZOOM = 3
const MAX_ZOOM = 16

function layerId(index: number): string {
  return `ask-${index + 1}`
}

/** A centre and zoom that fit every point, with some margin. */
export function fitCamera(points: LatLng[]): CanvasBody['camera'] | undefined {
  if (!points.length) return undefined
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const [south, north] = [Math.min(...lats), Math.max(...lats)]
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)]
  const span = Math.max(north - south, (east - west) * Math.cos(((north + south) / 2) * (Math.PI / 180)), 1e-4)
  const zoom = Math.log2(WORLD_DEGREES / span) - 1
  return {
    center: [(west + east) / 2, (south + north) / 2],
    zoom: Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 10) / 10,
  }
}

/** Places as labelled points, one layer per group, and a planned trip as a line. */
export function askCanvasBody(groups: CanvasPlaceGroup[], trip?: { name: string; path: LatLng[] }): CanvasBody {
  const layers: CanvasDataLayer[] = groups
    .filter((group) => group.places.length)
    .map((group, index) => ({
      id: layerId(index),
      kind: 'data',
      name: group.name,
      visible: true,
      render: 'points',
      origin: { format: 'drawn' },
      style: {
        color: group.color && HEX.test(group.color) ? group.color : COLORS[index % COLORS.length],
        size: 7,
        opacity: 0.95,
        labelProperty: 'name',
      },
      data: {
        type: 'FeatureCollection',
        features: group.places.map(({ lat, lng, name, placeId, type }) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: { name, ...(placeId && { placeId }), ...(type && { type }) },
        })),
      },
    }))
  if (trip && trip.path.length > 1) {
    layers.unshift({
      id: layerId(layers.length),
      kind: 'data',
      name: trip.name,
      visible: true,
      render: 'lines',
      origin: { format: 'drawn' },
      style: { color: '#2563eb', size: 4, opacity: 0.9 },
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: trip.path.map(({ lat, lng }) => [lng, lat]) },
            properties: { name: trip.name },
          },
        ],
      },
    })
  }
  const points = [...groups.flatMap((group) => group.places), ...(trip?.path ?? [])]
  const camera = fitCamera(points)
  return { layers, ...(camera && { camera }) }
}
