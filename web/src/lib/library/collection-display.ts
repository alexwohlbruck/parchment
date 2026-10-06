import type { Collection } from '@/types/library.types'
import type { ThemeColor } from '@/lib/utils'

export interface CollectionIcon {
  icon?: string
  iconPack: 'lucide' | 'maki'
  color: ThemeColor
}

/** `ItemIcon` props for a collection; a locked one shows a lock, not its own icon. */
export function collectionIcon(collection: Collection): CollectionIcon {
  if (collection.locked) {
    return { icon: 'Lock', iconPack: 'lucide', color: 'parchment' }
  }
  return {
    icon: collection.icon ?? undefined,
    iconPack: collection.iconPack ?? 'lucide',
    color: (collection.iconColor as ThemeColor | undefined) ?? 'cobalt',
  }
}
