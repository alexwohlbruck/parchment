import { describe, it, expect } from 'vitest'
import {
  externalMapUrl,
  mapEditorUrl,
  type ExternalMapService,
  type MapEditor,
} from './external-map-links'

const NYC = { lat: 40.7128, lng: -74.006 } as never

const SERVICES: ExternalMapService[] = ['osm', 'google', 'apple', 'yandex', '2gis']
const EDITORS: MapEditor[] = ['id', 'rapid', 'josm']

describe('externalMapUrl', () => {
  it.each(SERVICES)('%s produces a parseable absolute URL', service => {
    const url = externalMapUrl(service, NYC, 14.6)
    expect(() => new URL(url)).not.toThrow()
    expect(url).toMatch(/^https?:\/\//)
  })

  it.each(SERVICES)('%s carries both coordinates', service => {
    const url = externalMapUrl(service, NYC, 14.6)
    expect(url).toContain('40.7128')
    expect(url).toContain('-74.006')
  })

  it('orders coordinates per each service’s own convention', () => {
    // lat,lng for the western services; lng,lat for the eastern ones. Getting
    // this backwards silently drops you in the wrong hemisphere.
    expect(externalMapUrl('google', NYC, 14)).toContain('@40.7128,-74.006')
    expect(externalMapUrl('osm', NYC, 14)).toContain('/40.7128/-74.006')
    expect(externalMapUrl('yandex', NYC, 14)).toContain('ll=-74.006%2C40.7128')
    expect(externalMapUrl('2gis', NYC, 14)).toContain('m=-74.006%2C40.7128')
  })

  it('rounds zoom up only where the service takes an integer', () => {
    expect(externalMapUrl('osm', NYC, 14.2)).toContain('map=15/')
    expect(externalMapUrl('yandex', NYC, 14.2)).toContain('z=15')
    // Google accepts fractional zoom, so it should be passed through.
    expect(externalMapUrl('google', NYC, 14.2)).toContain(',14.2z')
  })

  it('converts zoom to a span for Apple, shrinking as you zoom in', () => {
    const near = externalMapUrl('apple', NYC, 18)
    const far = externalMapUrl('apple', NYC, 10)
    const span = (url: string) => Number(new URL(url).searchParams.get('span')!.split(',')[0])
    expect(span(near)).toBeLessThan(span(far))
  })
})

describe('mapEditorUrl', () => {
  it.each(EDITORS)('%s produces a parseable URL with both coordinates', editor => {
    const url = mapEditorUrl(editor, NYC)
    expect(() => new URL(url)).not.toThrow()
    expect(url).toContain('40.7128')
    expect(url).toContain('-74.006')
  })

  it('points JOSM at its localhost remote-control port', () => {
    expect(mapEditorUrl('josm', NYC)).toContain('127.0.0.1:8111')
  })

  it('opens the web editors at building-level zoom', () => {
    expect(mapEditorUrl('id', NYC)).toContain('map=18/')
    expect(mapEditorUrl('rapid', NYC)).toContain('map=18/')
  })
})
