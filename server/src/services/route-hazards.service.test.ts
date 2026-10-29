import { describe, expect, test } from 'bun:test'
import { attachHazards } from './route-hazards.service'
import type { RoutePointHazard } from '../types/unified-routing.types'

const geometry = Array.from({ length: 101 }, (_, i) => ({ lat: 40 + i * 0.00009, lng: -74 }))
const street = (edgeSegments: any[] = []) => ({ mode: 'driving', geometry, distance: 1000, edgeSegments }) as any
const stop: RoutePointHazard = { kind: 'stop', distance: 400, coordinate: [-74, 40.0036], osm: 'node/1' }
const toll: RoutePointHazard = { kind: 'toll', distance: 600, coordinate: [-74, 40.0054], osm: 'node/2', detail: 'booth' }
const noWeather = async () => null

describe('attachHazards', () => {
  test('adds what barrelman found to what the edges show', async () => {
    const segment = street([{ startDistance: 0, endDistance: 100, crossing: 'MARKED' }])
    await attachHazards([segment], { premium: false, getHazards: async () => [stop], getOutlook: noWeather })
    expect(segment.hazards.map((h: any) => h.kind)).toEqual(['crosswalk', 'stop'])
  })

  test('a barrelman that cannot answer leaves the edge hazards standing', async () => {
    const segment = street([{ startDistance: 0, endDistance: 100, crossing: 'TRAFFIC_SIGNALS' }])
    await attachHazards([segment], { premium: false, getHazards: async () => { throw new Error('down') }, getOutlook: noWeather })
    expect(segment.hazards.map((h: any) => h.kind)).toEqual(['traffic_signals'])
  })

  test('premium kinds are stripped for everyone else, including nested segments', async () => {
    const nested = street()
    const trip = [{ mode: 'multimodal', details: { multimodalSegments: [nested] } }] as any[]
    await attachHazards(trip, { premium: false, getHazards: async () => [stop, toll], getOutlook: noWeather })
    expect(nested.hazards.map((h: any) => h.kind)).toEqual(['stop'])
    await attachHazards(trip, { premium: true, getHazards: async () => [stop, toll], getOutlook: noWeather })
    expect(nested.hazards.map((h: any) => h.kind)).toEqual(['stop', 'toll'])
  })

  test('asks the forecast only when a bridge or flood-prone road needs it', async () => {
    const asked: number[] = []
    const getOutlook = async (lat: number) => (asked.push(lat), { rain: false, minTemperature: -3 })
    const flat = street()
    await attachHazards([flat], { premium: false, getHazards: async () => [], getOutlook })
    expect(asked).toEqual([])
    const bridged = street([{ startDistance: 200, endDistance: 300, roadEnvironment: 'bridge' }])
    await attachHazards([bridged], { premium: false, getHazards: async () => [], getOutlook })
    expect(asked).toHaveLength(1)
    expect(bridged.hazards.map((h: any) => h.kind)).toEqual(['icy_bridge'])
  })
})
