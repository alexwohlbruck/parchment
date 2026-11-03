import { describe, test, expect } from 'vitest'
import { collectionIcon } from './collection-display'
import type { Collection } from '@/types/library.types'

const base = {
  id: 'c',
  userId: 'u',
  isPublic: false,
  scheme: 'user-e2ee',
  resharingPolicy: 'owner-only',
  createdAt: '',
  updatedAt: '',
} satisfies Collection

describe('collectionIcon', () => {
  test('a locked collection shows a lock, never a stale icon', () => {
    expect(
      collectionIcon({ ...base, locked: true, icon: 'Coffee', iconColor: 'rose' }),
    ).toEqual({ icon: 'Lock', iconPack: 'lucide', color: 'parchment' })
  })

  test('an open collection shows its own icon', () => {
    expect(
      collectionIcon({ ...base, icon: 'cafe', iconPack: 'maki', iconColor: 'rose' }),
    ).toEqual({ icon: 'cafe', iconPack: 'maki', color: 'rose' })
  })
})
