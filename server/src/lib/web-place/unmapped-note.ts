import type { Place } from '../../types/place.types'
import type { TranslateFn } from '../i18n/i18n.types'

type Unmapped = Omit<NonNullable<Place['unmapped']>, 'noteText'>

const CATEGORY = /^(?:construction:)?(?:amenity|shop|craft|office|tourism|leisure|healthcare|club)$/

/** A note for mappers that carries every tag the place would get, ready to copy into an editor. */
export function unmappedNoteText(name: string, site: string, unmapped: Unmapped, t: TranslateFn): string {
  const rank = (key: string) => (CATEGORY.test(key) ? 0 : key === 'name' ? 1 : key.startsWith('addr:') ? 3 : 2)
  const tags = Object.entries(unmapped.tags)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
  const former = unmapped.replaces
  const replaces =
    former &&
    t(former.formerName ? 'webPlace.note.replacesNamed' : 'webPlace.note.replaces', {
      element: `${former.type} ${former.id}`,
      former: former.formerName ?? '',
    })
  return [
    [t('webPlace.note.intro', { name }), unmapped.opensSoon && t('webPlace.note.opensSoon'), replaces]
      .filter(Boolean)
      .join(' '),
    t('webPlace.note.found', { site }),
    '',
    t('webPlace.note.tags'),
    ...tags,
  ].join('\n')
}
