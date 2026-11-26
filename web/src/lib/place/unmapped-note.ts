import type { Place } from '@/types/place.types'

interface NoteWords {
  /** "{name} is missing from the map." and the like, already filled in. */
  intro: string
  opensSoon: string
  /** "It replaces node 2603955337 (Coogan's)." */
  replaces?: string
  tagsHeading: string
}

const CATEGORY = /^(?:construction:)?(?:amenity|shop|craft|office|tourism|leisure|healthcare|club)$/

/** A note for mappers that carries every tag the place would get, ready to copy into an editor. */
export function unmappedNoteText(unmapped: NonNullable<Place['unmapped']>, words: NoteWords): string {
  const rank = (key: string) => (CATEGORY.test(key) ? 0 : key === 'name' ? 1 : key.startsWith('addr:') ? 3 : 2)
  const tags = Object.entries(unmapped.tags)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
  return [
    [words.intro, unmapped.opensSoon && words.opensSoon, unmapped.replaces && words.replaces].filter(Boolean).join(' '),
    '',
    words.tagsHeading,
    ...tags,
  ].join('\n')
}
