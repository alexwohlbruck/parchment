import type { Collection } from '@/types/library.types'

/** Owners and editors can change what is in a collection; viewers only read. */
export function canWriteCollection(collection: Pick<Collection, 'role'>): boolean {
  return !collection.role || collection.role === 'owner' || collection.role === 'editor'
}
