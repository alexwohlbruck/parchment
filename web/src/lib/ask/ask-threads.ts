import { createRecentsStore } from '@/lib/recents/recents-store'
import type { AskExchange, AskHistoryDays, AskThread } from '@/types/ask.types'
import type { Place } from '@/types/place.types'

const DAY_MS = 86_400_000

/** Ask threads, end-to-end encrypted on the account like recent searches. */
export const askThreads = createRecentsStore<AskThread>({
  blobType: 'ask-threads',
  maxEntries: 100,
  identityOf: thread => thread.id,
})

/** What a place card needs, without reviews, photos and widgets. */
function compactPlace(place: Place): Place {
  return {
    id: place.id,
    externalIds: place.externalIds,
    name: place.name,
    description: null,
    placeType: place.placeType,
    icon: place.icon,
    geometry: place.geometry,
    photos: [],
    address: place.address,
    contactInfo: {
      phone: place.contactInfo?.phone ?? null,
      email: null,
      website: place.contactInfo?.website ?? null,
      socials: {},
    },
    openingHours: place.openingHours,
    amenities: {},
    ratings: place.ratings,
    summary: place.summary,
    timezone: place.timezone,
    sources: place.sources,
    lastUpdated: place.lastUpdated,
    createdAt: place.createdAt,
  } as Place
}

/** An answered exchange as history keeps it. A trip's plan goes stale, so only its ends are kept. */
function savedExchange(exchange: AskExchange): AskExchange {
  const { reach, plan, trip, ...rest } = exchange
  return {
    ...rest,
    places: exchange.places.map(({ place, reason }) => ({ place: compactPlace(place), reason })),
    ...(trip && {
      trip: { from: trip.from, to: trip.to, kind: trip.kind, stops: trip.stops, time: trip.time, lines: trip.lines },
      plan: null,
    }),
  }
}

export function savedThread(
  { id, createdAt, exchanges }: { id: string; createdAt: number; exchanges: AskExchange[] },
  now: number,
): AskThread | null {
  const answered = exchanges.filter(exchange => exchange.status === 'done')
  if (!answered.length) return null
  return {
    id,
    title: answered[0].question,
    createdAt,
    at: now,
    exchanges: answered.map(savedExchange),
  }
}

/** Whether a thread last used at `at` is past the history length; 0 keeps it forever. */
export function isThreadExpired(thread: Pick<AskThread, 'at'>, keepDays: AskHistoryDays, now: number): boolean {
  return keepDays > 0 && now - thread.at > keepDays * DAY_MS
}
