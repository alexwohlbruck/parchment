import { describe, expect, test } from 'vitest'
import type { RouteEdgeSegment, RouteInstruction } from '@/types/directions.types'
import { buildNavRoute, type NavRoute } from './nav-route'
import { polyline, translator } from './test-routes'
import { richInstruction } from './instructions/rich-instruction'
import { voiceText } from './instructions/instruction-text'
import en from '@/lib/i18n/en-US.json'
import es from '@/lib/i18n/es-ES.json'

const t = translator(en)
const tEs = translator(es)

type Step = Partial<RouteInstruction> & { at: number }

/** 100 m east on Jay Street, left onto a ramp that switches back twice, then 300 m north. */
function ramp(edges: Partial<RouteEdgeSegment>[], { mode = 'walking', named = '', path = mode === 'walking' ? 'footway' : 'cycleway' } = {}): NavRoute {
  const line = polyline([[90, 100], [0, 60], [160, 60], [0, 360]])
  const near = (s: number) => line[Math.round(s / 10)]
  const steps: Step[] = [
    { at: 0, type: 'depart', streetName: 'Jay Street' },
    { at: 100, modifier: 'left', streetName: named },
    { at: 160, modifier: 'sharp-right', streetName: named },
    { at: 220, modifier: 'sharp-left', streetName: named },
    { at: 280, type: 'continue', modifier: 'straight', streetName: 'Manhattan Bridge Path' },
  ]
  return buildNavRoute([{
    mode,
    geometry: line,
    instructions: [
      ...steps.map(({ at, ...step }) => ({ type: 'turn', text: '', coordinate: near(at), distance: 60, duration: 40, ...step })),
      { type: 'destination', text: '', coordinate: line.at(-1)!, distance: 0, duration: 0 },
    ],
    edgeSegments: [
      { startDistance: 0, endDistance: 100, roadClass: 'footway', streetName: 'Jay Street' },
      { startDistance: 100, endDistance: 580, roadClass: path },
      ...edges,
    ].map(e => ({ startDistance: 0, endDistance: 0, ...e })),
  }])
}

const words = (route: NavRoute, translate = t) =>
  route.steps.map(step => voiceText(richInstruction(route, step, { from: step.startDistance - 30, speed: 1.4 }), translate))

describe('rampSteps', () => {
  test('switchbacks up to a bridge are one instruction', () => {
    const route = ramp([{ startDistance: 290, endDistance: 580, roadClass: 'footway', roadEnvironment: 'bridge' }])
    expect(words(route)).toEqual([
      'Continue straight onto Jay Street',
      'Turn left onto the path',
      'Follow the ramp up to the bridge',
      'You have arrived',
    ])
    expect(words(route, tEs)[2]).toBe('Sube por la rampa hasta el puente')
  })

  test('down off a bridge, and by the grade where there is no bridge', () => {
    const off = ramp([{ startDistance: 60, endDistance: 100, roadClass: 'footway', roadEnvironment: 'bridge' }], { mode: 'cycling' })
    expect(words(off)[2]).toBe('Follow the ramp down')
    const graded = ramp([{ startDistance: 160, endDistance: 280, roadClass: 'footway', averageSlope: 5 }])
    expect(words(graded)[2]).toBe('Follow the ramp up')
    expect(words(ramp([]))[2]).toBe('Follow the ramp')
  })

  test('a lone hairpin stays a turn', () => {
    const line = polyline([[0, 100], [160, 100]])
    const route = buildNavRoute([{
      mode: 'walking',
      geometry: line,
      instructions: [
        { type: 'depart', text: '', coordinate: line[0], distance: 100, duration: 70 },
        { type: 'turn', modifier: 'sharp-right', text: '', coordinate: line[10], distance: 100, duration: 70 },
        { type: 'destination', text: '', coordinate: line.at(-1)!, distance: 0, duration: 0 },
      ],
      edgeSegments: [{ startDistance: 0, endDistance: 200, roadClass: 'footway' }],
    }])
    expect(route.steps.map(s => s.ramp)).toEqual([undefined, undefined, undefined])
  })

  test('switchbacks on a street are turns', () => {
    const route = ramp([], { mode: 'cycling', path: 'residential' })
    expect(route.steps.some(s => s.ramp)).toBe(false)
  })
})
