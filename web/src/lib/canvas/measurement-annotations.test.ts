import { describe, expect, it } from 'vitest'
import type { IsochroneBand } from '@/lib/directions/isochrone'
import { pathLengthMeters, polygonAreaSquareMeters } from '@/lib/measure/measure'
import { annotationMeasurement } from './canvas-annotations'
import {
  isochroneAnnotations,
  measureAnnotation,
  radiusAnnotation,
} from './measurement-annotations'

const a = { lng: -73.99, lat: 40.75 }
const b = { lng: -73.98, lat: 40.75 }
const c = { lng: -73.98, lat: 40.76 }

describe('measureAnnotation', () => {
  it('keeps an open path as a line that measures the same', () => {
    const mark = measureAnnotation([a, b, c], false)!

    expect(mark.tool).toBe('line')
    expect(annotationMeasurement(mark)?.value).toBeCloseTo(pathLengthMeters([a, b, c]))
  })

  it('turns a closed loop into a polygon without the repeated start', () => {
    const mark = measureAnnotation([a, b, c, { ...a }], true)!

    expect(mark.tool).toBe('polygon')
    expect(mark.positions).toHaveLength(3)
    expect(annotationMeasurement(mark)?.value).toBeCloseTo(
      polygonAreaSquareMeters([a, b, c]),
    )
  })

  it('needs two points', () => {
    expect(measureAnnotation([a], false)).toBeNull()
  })
})

describe('radiusAnnotation', () => {
  it('is a circle at the centre with the measured radius', () => {
    expect(radiusAnnotation(a, 120)).toMatchObject({
      tool: 'circle',
      positions: [[a.lng, a.lat]],
      radiusMeters: 120,
    })
    expect(radiusAnnotation(a, 0)).toBeNull()
  })
})

describe('isochroneAnnotations', () => {
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]]
  const band = (bucket: number, minutes: number, geometry: IsochroneBand['geometry']) =>
    ({ bucket, durationMinutes: minutes, durationSeconds: minutes * 60, geometry, opacity: 0.3 }) as IsochroneBand

  it('puts the outermost band first and splits islands into marks', () => {
    const marks = isochroneAnnotations(
      a,
      [
        band(0, 5, { type: 'Polygon', coordinates: [ring] }),
        band(1, 10, { type: 'MultiPolygon', coordinates: [[ring], [ring]] }),
      ],
      'walk',
      minutes => `${minutes} min`,
    )

    expect(marks.map(m => m.label)).toEqual(['10 min', '10 min', '5 min'])
    expect(marks[0]).toMatchObject({
      tool: 'isochrone',
      fillOpacity: 0.3,
      isochrone: { mode: 'walk', minutes: 10, geometry: [ring] },
    })
  })
})
