import type { Bookmark, DecryptedPoint } from '@/types/library.types'
import type { FrequentType } from '@/lib/frequents'

/** A private collection's point, shaped like a bookmark row for the shared list UI. */
export function pointAsBookmark(point: DecryptedPoint, ownerUserId: string): Bookmark {
  return {
    ...point,
    address: point.address ?? undefined,
    frequentType: (point.frequentType ?? undefined) as FrequentType | undefined,
    userId: ownerUserId,
    createdAt: point.createdAt ?? '',
    updatedAt: point.updatedAt ?? point.createdAt ?? '',
  }
}
