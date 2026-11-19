import { describe, expect, it } from 'vitest'
import type { Feature, FeatureCollection } from 'geojson'
import {
  annotationExportFeature,
  canvasCollection,
  geoJsonFilename,
  splitAnnotations,
} from './geo-export'
import { parseGeoData } from './geo-import'
import { createAnnotation } from './canvas-annotations'
import type { CanvasAnnotation, CanvasDataLayer } from '@/types/canvas.types'

function roundTrip(annotations: CanvasAnnotation[]) {
  const text = JSON.stringify(canvasCollection({ annotations, layers: [] }))
  return splitAnnotations(parseGeoData(text, 'canvas.geojson').collection)
}

const withoutId = ({ id: _id, ...rest }: CanvasAnnotation) => rest

describe('canvas GeoJSON round trip', () => {
  it('brings every kind of mark back as it was, under a new id', () => {
    const pin = {
      ...createAnnotation('pin', [[-73.98, 40.75]]),
      label: 'Lunch',
      color: 'rose',
      icon: 'Utensils',
      labelPosition: 'top' as const,
    }
    const circle = {
      ...createAnnotation('circle', [[-73.9, 40.7]]),
      radiusMeters: 250,
    }
    const rectangle = createAnnotation('rectangle', [
      [0, 0],
      [1, 0],
      [1, 1],
    ])
    const route = createAnnotation('route', [[0, 0], [2, 2]], {}, {
      geometry: [[0, 0], [1, 0.5], [2, 2]],
      mode: 'walking',
      distance: 300,
    })
    const isochrone = {
      ...createAnnotation('isochrone', [[0, 0]]),
      isochrone: {
        geometry: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        mode: 'walk',
        minutes: 15,
      },
    }
    const marks = [pin, circle, rectangle, route, isochrone]

    const { annotations, rest } = roundTrip(marks)

    expect(rest.features).toHaveLength(0)
    expect(annotations.map(withoutId)).toEqual(marks.map(withoutId))
    expect(annotations.every((a, i) => a.id !== marks[i].id)).toBe(true)
  })

  it('leaves features from other tools as data', () => {
    const foreign: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: { name: 'Somewhere', parchment: { tool: 'laser' } },
    }
    const exported = annotationExportFeature(createAnnotation('pin', [[3, 4]]))!

    const { annotations, rest } = splitAnnotations({
      type: 'FeatureCollection',
      features: [foreign, exported],
    })

    expect(annotations).toHaveLength(1)
    expect(rest.features).toEqual([foreign])
  })
})

describe('canvasCollection', () => {
  it('writes simplestyle for other tools, and data layers as they are', () => {
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 5] }, properties: { a: 1 } },
      ],
    }
    const layer: CanvasDataLayer = {
      id: 'cl-1',
      kind: 'data',
      name: 'Imported',
      visible: true,
      render: 'points',
      data,
    }
    const polygon = createAnnotation('polygon', [[0, 0], [1, 0], [1, 1]])

    const collection = canvasCollection(
      { annotations: [polygon], layers: [layer] },
      () => '#123456',
    )

    expect(collection.features).toHaveLength(2)
    expect(collection.features[0].properties).toMatchObject({
      stroke: '#123456',
      fill: '#123456',
      'stroke-width': 3,
    })
    expect(collection.features[1]).toEqual(data.features[0])
  })

  it('skips a mark with too few positions to draw', () => {
    expect(annotationExportFeature(createAnnotation('line', [[0, 0]]))).toBeNull()
  })
})

describe('geoJsonFilename', () => {
  it('slugs a name and falls back when nothing is left', () => {
    expect(geoJsonFilename('Café run · Brooklyn')).toBe('cafe-run-brooklyn.geojson')
    expect(geoJsonFilename('—')).toBe('parchment.geojson')
  })
})
