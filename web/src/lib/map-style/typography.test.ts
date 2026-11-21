import { describe, expect, test } from 'vitest'
import { buildLayers } from './build'
import { MAP_STYLE_IDS } from '@/types/map.types'
import { themeTypography } from './themes'

const fontsIn = (layers: any[]) =>
  new Set(layers.flatMap(l => JSON.stringify(l.layout?.['text-font'] ?? []).match(/[A-Z][a-z]+ (Regular|Medium|SemiBold|Bold)/g) ?? []))

describe('theme typography', () => {
  test.each(MAP_STYLE_IDS)('%s sets every label in its own family', style => {
    const { family = 'Geist', districtLabels } = themeTypography(style) ?? {}
    const fonts = [...fontsIn(buildLayers({ flavor: 'light', mapStyle: style, hdRoads: true }))]
    expect(fonts.length).toBeGreaterThan(0)
    expect(fonts.filter(f => !f.startsWith(family) && !districtLabels?.font.endsWith(f))).toEqual([])
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
  })
})

describe('darkening roads', () => {
  test('cupertino roads reach the asphalt at street zoom', () => {
    const minor = buildLayers({ flavor: 'light', mapStyle: 'cupertino' }).find(l => l.id === 'Minor road') as any
    const ramp = minor.paint['line-color']
    expect(ramp[0]).toBe('interpolate')
    expect(ramp.at(-1)).toBe('hsl(200, 6%, 66%)')
  })

  test('parchment roads keep their colour', () => {
    const minor = buildLayers({ flavor: 'light', mapStyle: 'parchment' }).find(l => l.id === 'Minor road') as any
    expect(typeof minor.paint['line-color']).toBe('string')
  })
})
