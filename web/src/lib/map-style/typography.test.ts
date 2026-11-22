import { describe, expect, test } from 'vitest'
import { buildLayers } from './build'
import { MAP_STYLE_IDS } from '@/types/map.types'
import { themeTypography } from './themes'

const fontsIn = (layers: any[]) =>
  new Set(layers.flatMap(l => JSON.stringify(l.layout?.['text-font'] ?? []).match(/[A-Z][\w ]*? (Regular|Medium|SemiBold|Bold|Italic)(?=")/g) ?? []))

describe('theme typography', () => {
  test.each(MAP_STYLE_IDS)('%s sets every label in its own family', style => {
    const { family = 'Geist', districtLabels, layerFaces = [] } = themeTypography(style) ?? {}
    const own = new Set([districtLabels?.font, ...layerFaces.map(face => face.font)])
    const fonts = [...fontsIn(buildLayers({ flavor: 'light', mapStyle: style, hdRoads: true }))]
    expect(fonts.length).toBeGreaterThan(0)
    expect(fonts.filter(f => !f.startsWith(`${family} `) && !own.has(f))).toEqual([])
  })

  test('cupertino names roads in spaced capitals', () => {
    const road = buildLayers({ flavor: 'light', mapStyle: 'cupertino' }).find(l => l.id === 'Road labels') as any
    expect(road.layout['text-transform']).toBe('uppercase')
    expect(road.layout['text-letter-spacing']).toBeGreaterThan(0)
  })

  test('cupertino sets district names in a condensed face', () => {
    const layers = buildLayers({ flavor: 'light', mapStyle: 'cupertino' }) as any[]
    const font = JSON.stringify(layers.find(l => l.id === 'Place labels').layout['text-font'])
    expect(font).toContain('Barlow Condensed SemiBold')
    expect(font).toContain('Inter Medium')
    const size = layers.find(l => l.id === 'Neighbourhood labels').layout['text-size']
    expect(size.slice(0, 3)).toEqual(['interpolate', ['linear', 1], ['zoom']])
    expect(size.at(-1)[0]).toBe('*')
  })

  test('chart sets its waters in italic and its towns in small capitals', () => {
    const layers = buildLayers({ flavor: 'light', mapStyle: 'chart' }) as any[]
    const font = (id: string) => layers.find(l => l.id === id).layout['text-font']
    expect(font('Ocean labels')).toEqual(['literal', ['IM Fell English Italic']])
    expect(font('City labels')).toEqual(['literal', ['IM Fell English SC Regular']])
    expect(layers.find(l => l.id === 'Country labels').layout['text-transform']).toBe('uppercase')
  })
})

describe('chart engraving', () => {
  test('lines the coast only on the chart', () => {
    const ids = (style: 'chart' | 'charlotte') => buildLayers({ flavor: 'light', mapStyle: style }).map(l => l.id)
    const chart = ids('chart')
    expect(chart.indexOf('Chart coastline')).toBeGreaterThan(chart.indexOf('Water'))
    expect(chart).toContain('Chart wood tufts')
    expect(ids('charlotte').filter(id => id.startsWith('Chart '))).toEqual([])
  })
})

describe('darkening roads', () => {
  test('cupertino roads reach the asphalt at street zoom', () => {
    const minor = buildLayers({ flavor: 'light', mapStyle: 'cupertino' }).find(l => l.id === 'Minor road') as any
    const ramp = minor.paint['line-color']
    expect(ramp[0]).toBe('interpolate')
    expect(ramp.at(-1)).toBe('hsl(200, 6%, 66%)')
  })

  test('charlotte roads keep their colour', () => {
    const minor = buildLayers({ flavor: 'light', mapStyle: 'charlotte' }).find(l => l.id === 'Minor road') as any
    expect(typeof minor.paint['line-color']).toBe('string')
  })
})
