import { describe, expect, it } from 'vitest'
import { cardinal, facesAway, turnsRound, TurnAroundWatch, type StartPose } from './turn-around'

const pose = (over: Partial<StartPose> = {}): StartPose => ({
  mode: 'walking',
  speed: 1.4,
  heading: 180,
  routeBearing: 0,
  s: 0,
  ...over,
})

describe('facesAway', () => {
  it('measures across north', () => {
    expect(facesAway(350, 170)).toBe(true)
    expect(facesAway(350, 20)).toBe(false)
  })

  it('needs more than a sideways glance', () => {
    expect(facesAway(0, 100)).toBe(false)
    expect(facesAway(0, 120)).toBe(true)
  })
})

describe('turnsRound', () => {
  it('applies to walkers and slow cyclists only', () => {
    expect(turnsRound('walking', 2)).toBe(true)
    expect(turnsRound('cycling', 2)).toBe(true)
    expect(turnsRound('biking', null)).toBe(true)
    expect(turnsRound('cycling', 6)).toBe(false)
    expect(turnsRound('driving', 0)).toBe(false)
    expect(turnsRound('transit', 0)).toBe(false)
  })
})

describe('cardinal', () => {
  it('names the nearest of eight points', () => {
    expect(cardinal(0)).toBe('north')
    expect(cardinal(359)).toBe('north')
    expect(cardinal(100)).toBe('east')
    expect(cardinal(-45)).toBe('northwest')
  })
})

describe('TurnAroundWatch', () => {
  it('raises once while the traveller faces away', () => {
    const watch = new TurnAroundWatch()
    expect(watch.update(pose())).toBe(true)
    expect(watch.update(pose({ heading: 170 }))).toBe(false)
    expect(watch.active).toBe(true)
  })

  it('clears once the traveller faces the route, and stays clear', () => {
    const watch = new TurnAroundWatch()
    watch.update(pose())
    expect(watch.update(pose({ heading: 20 }))).toBe(false)
    expect(watch.active).toBe(false)
    expect(watch.update(pose())).toBe(false)
  })

  it('waits through an in-between heading or none at all', () => {
    const watch = new TurnAroundWatch()
    expect(watch.update(pose({ heading: 90 }))).toBe(false)
    expect(watch.update(pose({ heading: null }))).toBe(false)
    expect(watch.update(pose())).toBe(true)
  })

  it('never raises for a driver', () => {
    const watch = new TurnAroundWatch()
    expect(watch.update(pose({ mode: 'driving' }))).toBe(false)
    expect(watch.update(pose())).toBe(false)
  })

  it('gives up once the traveller is under way', () => {
    const watch = new TurnAroundWatch(100)
    expect(watch.update(pose({ s: 140 }))).toBe(false)
    expect(watch.update(pose({ s: 140 }))).toBe(false)
  })
})
