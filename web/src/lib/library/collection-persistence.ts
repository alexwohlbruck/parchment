import type { Collection } from '@/types/library.types'

/**
 * A collection as it may be written to disk. A private collection's decrypted
 * name and look stay in memory; its sealed envelope is what persists.
 */
export function persistableCollection<T extends Collection>(collection: T): T {
  if (collection.scheme !== 'user-e2ee') return collection
  const {
    name: _name,
    description: _description,
    icon: _icon,
    iconPack: _iconPack,
    iconColor: _iconColor,
    ...sealed
  } = collection
  return sealed as T
}
