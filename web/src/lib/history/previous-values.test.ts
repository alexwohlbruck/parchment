import { describe, test, expect } from 'vitest'
import { previousValues } from '@/lib/history/previous-values'

describe('previousValues', () => {
  test('takes only the fields being changed', () => {
    const current = { name: 'Coffee', icon: 'cup', color: 'red' }
    expect(previousValues(current, { name: 'Tea' })).toEqual({ name: 'Coffee' })
  })

  test('clears a field that was unset before', () => {
    const current: { name: string; description?: string } = { name: 'Coffee' }
    expect(previousValues(current, { description: 'Beans' })).toEqual({ description: null })
  })

  test('copies nested values so later edits cannot reach them', () => {
    const current = { tags: ['a'] }
    const previous = previousValues(current, { tags: ['b'] })
    current.tags.push('c')
    expect(previous).toEqual({ tags: ['a'] })
  })
})
