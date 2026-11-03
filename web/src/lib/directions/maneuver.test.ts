import { describe, expect, test } from 'vitest'
import { maneuverKind } from './maneuver'

describe('maneuverKind', () => {
  test.each([
    [{ type: 'turn', modifier: 'left' }, 'left'],
    [{ type: 'turn', modifier: 'sharp-right' }, 'sharp-right'],
    [{ type: 'turn', modifier: 'slight-left' }, 'slight-left'],
    [{ type: 'continue', modifier: 'slight-right' }, 'keep-right'],
    [{ type: 'continue', modifier: 'straight' }, 'straight'],
    [{ type: 'destination' }, 'arrive'],
    [{ type: 'roundabout' }, 'roundabout'],
    [{ type: 'turn', modifier: 'u-turn' }, 'uturn'],
    [{ type: 'keep-left' }, 'keep-left'],
    [{ type: 'turn-sharp-left', modifier: 'sharp-left' }, 'sharp-left'],
    [{ type: 'roundabout-enter' }, 'roundabout'],
    [{ type: 'arrive' }, 'arrive'],
  ] as const)('%o → %s', (instruction, kind) => {
    expect(maneuverKind(instruction)).toBe(kind)
  })
})
