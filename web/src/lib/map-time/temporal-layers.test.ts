import { describe, expect, test } from 'vitest'
import { activeTemporalLayerIds, TEMPORAL_LAYERS } from './temporal-layers'

const TRANSIT = 'default:group:transit'
const DAYNIGHT = 'default:group:daynight'

const visible = (...ids: string[]) => (id: string) => ids.includes(id)
const appearances = (map: Record<string, string>) => (id: string) => map[id]

describe('activeTemporalLayerIds', () => {
  test('declares transit and day/night', () => {
    expect(TEMPORAL_LAYERS.map(l => l.groupId)).toEqual([TRANSIT, DAYNIGHT])
  })

  test('nothing is active while every temporal layer is off', () => {
    expect(activeTemporalLayerIds(visible(), appearances({}))).toEqual([])
  })

  test('day/night reads the time whatever its appearance', () => {
    expect(activeTemporalLayerIds(visible(DAYNIGHT), appearances({}))).toEqual([DAYNIGHT])
  })

  test('transit reads the time only while it shows the live network', () => {
    expect(activeTemporalLayerIds(visible(TRANSIT), appearances({ [TRANSIT]: 'live' }))).toEqual([TRANSIT])
    expect(activeTemporalLayerIds(visible(TRANSIT), appearances({ [TRANSIT]: 'full-service' }))).toEqual([])
  })

  test('lists every active layer in declaration order', () => {
    expect(
      activeTemporalLayerIds(visible(DAYNIGHT, TRANSIT), appearances({ [TRANSIT]: 'live' })),
    ).toEqual([TRANSIT, DAYNIGHT])
  })
})
