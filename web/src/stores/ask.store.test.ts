import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAskStore } from './ask.store'

describe('ask store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('builds the current exchange from the stream, trip included', () => {
    const store = useAskStore()
    store.start('how do I get home on citibike', { followUp: false })
    store.apply({ type: 'step', id: 's1', tool: 'plan_trip', label: 'Planning the trip', status: 'running' })
    store.apply({ type: 'step', id: 's1', tool: 'plan_trip', label: 'Planning the trip', status: 'done' })
    store.apply({
      type: 'trip',
      from: { lat: 40.666, lng: -73.96 },
      to: { name: 'Home', lat: 40.672, lng: -73.953 },
      kind: 'bikeshare',
    })
    store.apply({ type: 'answer', text: 'Grab a bike at Carroll St.', places: [] })
    store.apply({ type: 'done' })

    expect(store.current).toMatchObject({
      status: 'done',
      steps: [{ id: 's1', status: 'done' }],
      trip: { to: { name: 'Home' }, kind: 'bikeshare' },
      text: 'Grab a bike at Carroll St.',
    })
  })

  it('replays a skill to follow-ups as the task, keyed to its subject', () => {
    const store = useAskStore()
    store.start('cafe wands', { followUp: false, skill: 'find-on-web' })
    store.apply({ type: 'answer', text: 'It has no street address yet.', places: [] })
    store.apply({ type: 'done' })

    expect(store.current).toMatchObject({ question: 'cafe wands', skill: 'find-on-web' })
    expect(store.history[0]).toEqual({ role: 'user', content: 'Find "cafe wands" on the web' })
  })

  it('keeps the route and canvas an answer saved', () => {
    const store = useAskStore()
    store.start('plan a ride around manhattan', { followUp: false })
    store.apply({ type: 'route', id: 'r1', name: 'Manhattan loop', mode: 'cycling', distance: 52000, duration: 12000 })
    store.apply({ type: 'canvas', id: 'c1', name: 'Manhattan loop' })
    expect(store.current).toMatchObject({ route: { id: 'r1', name: 'Manhattan loop' }, canvas: { id: 'c1' } })
  })

  it('keeps earlier exchanges only for a follow-up', () => {
    const store = useAskStore()
    store.start('first', { followUp: false })
    store.apply({ type: 'done' })
    store.start('second', { followUp: true })
    expect(store.exchanges.map(e => e.question)).toEqual(['first', 'second'])
    store.start('fresh', { followUp: false })
    expect(store.exchanges.map(e => e.question)).toEqual(['fresh'])
  })
})
