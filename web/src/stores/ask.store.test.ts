import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAskStore } from './ask.store'

describe('ask store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('builds the current exchange from the stream, trip included', () => {
    const store = useAskStore()
    store.start('how do I get home on citibike', { followUp: false })
    store.apply({ type: 'step', id: 's1', label: 'Planning the trip', status: 'running' })
    store.apply({ type: 'step', id: 's1', label: 'Planning the trip', status: 'done' })
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
