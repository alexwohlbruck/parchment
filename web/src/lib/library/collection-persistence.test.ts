import { describe, test, expect } from 'vitest'
import { persistableCollection } from './collection-persistence'
import type { Collection } from '@/types/library.types'

const base = {
  id: 'c',
  userId: 'u',
  isPublic: false,
  resharingPolicy: 'owner-only',
  createdAt: '',
  updatedAt: '',
  name: 'Hideouts',
  description: 'Quiet corners',
  icon: 'cafe',
  iconColor: 'rose',
  metadataEncrypted: 'sealed',
} as const

describe('persistableCollection', () => {
  test('drops a private collection’s decrypted metadata, keeping the envelope', () => {
    const stored = persistableCollection({ ...base, scheme: 'user-e2ee' } as Collection)

    expect(stored.name).toBeUndefined()
    expect(stored.description).toBeUndefined()
    expect(stored.metadataEncrypted).toBe('sealed')
  })

  test('keeps a shareable collection as it is', () => {
    const shareable = { ...base, scheme: 'server-key' } as Collection

    expect(persistableCollection(shareable)).toEqual(shareable)
  })
})
