import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../db'
import { webPlaceListings, type WebPlaceListing } from '../schema/web-place-listings.schema'
import { getOsmConfig } from '../config/osm.config'
import { logError, logger } from '../lib/logger'
import { normalizeName } from '../lib/web-place/site-page'
import { openOsmNoteTexts, osmAccountToken, postOsmNote } from './osm-account.service'
import { mappedNamesake } from './web-place.service'
import type { Place } from '../types/place.types'

/** How long a found place stays open before mappers get a note about it. */
export const LISTING_TTL_MS = 24 * 60 * 60_000
const SWEEP_INTERVAL_MS = 10 * 60_000
const SWEEP_BATCH = 20
/** About 50 m either side, to find a note someone already left about the place. */
const NOTE_SEARCH_DEG = 0.0005

type Resolution = NonNullable<WebPlaceListing['resolution']>

/** Keeps a place found on the web, first finder's, so it outlives a restart and gets a note if no one adds it. */
export async function listWebPlace(place: Place, userId: string): Promise<void> {
  await db
    .insert(webPlaceListings)
    .values({ id: place.id, userId, place, expiresAt: new Date(Date.now() + LISTING_TTL_MS) })
    .onConflictDoNothing()
}

/** A listed place, while it hasn't expired. */
export async function listedWebPlace(id: string): Promise<Place | null> {
  const [row] = await db
    .select({ place: webPlaceListings.place })
    .from(webPlaceListings)
    .where(and(eq(webPlaceListings.id, id), gt(webPlaceListings.expiresAt, new Date())))
  return row?.place ?? null
}

/** Marks a listing done, so it never gets an automatic note. */
export async function resolveWebPlace(id: string, resolution: 'added' | 'noted'): Promise<void> {
  await db
    .update(webPlaceListings)
    .set({ resolvedAt: new Date(), resolution })
    .where(and(eq(webPlaceListings.id, id), isNull(webPlaceListings.resolvedAt)))
}

/** Development servers only post to the OSM sandbox, never to the real map. */
function maySendNotes(): boolean {
  return process.env.NODE_ENV === 'production' || getOsmConfig().server !== 'production'
}

/** Leaves a note for every expired listing no one added or noted, claiming each first so it's posted once. */
export async function noteExpiredListings(): Promise<number> {
  if (!maySendNotes()) return 0
  const claimed = await db
    .update(webPlaceListings)
    .set({ resolvedAt: new Date() })
    .where(
      sql`${webPlaceListings.id} in (
        select ${webPlaceListings.id} from ${webPlaceListings}
        where ${webPlaceListings.resolvedAt} is null and ${webPlaceListings.expiresAt} < now()
        limit ${SWEEP_BATCH}
        for update skip locked
      )`,
    )
    .returning()
  for (const listing of claimed) {
    const { resolution, noteId } = await noteListing(listing).catch((error) => {
      logError('Failed to leave a note for a web place', error)
      return { resolution: 'failed' as const, noteId: undefined }
    })
    await db.update(webPlaceListings).set({ resolution, noteId }).where(eq(webPlaceListings.id, listing.id))
  }
  return claimed.length
}

async function noteListing({ place, userId }: WebPlaceListing): Promise<{ resolution: Resolution; noteId?: number }> {
  const center = place.geometry?.value?.center
  const name = place.name?.value
  const text = place.unmapped?.noteText
  if (!center || !name || !text) return { resolution: 'failed' }
  if (await mappedNamesake(name, center, { near: center })) return { resolution: 'mapped' }
  if (await openNoteNames(name, center)) return { resolution: 'already-noted' }
  const token = await osmAccountToken(userId)
  if (!token) return { resolution: 'no-account' }
  const note = await postOsmNote(token, center.lat, center.lng, text)
  return { resolution: 'auto-noted', noteId: note?.properties?.id }
}

/** True when an open note near the place already names it. */
async function openNoteNames(name: string, { lat, lng }: { lat: number; lng: number }): Promise<boolean> {
  const bbox = [lng - NOTE_SEARCH_DEG, lat - NOTE_SEARCH_DEG, lng + NOTE_SEARCH_DEG, lat + NOTE_SEARCH_DEG].join(',')
  const wanted = ` ${normalizeName(name)} `
  return (await openOsmNoteTexts(bbox)).some((text) => ` ${normalizeName(text)} `.includes(wanted))
}

let timer: ReturnType<typeof setInterval> | null = null

export function startListingSweeper(): void {
  if (timer || process.env.NODE_ENV === 'test') return
  timer = setInterval(() => {
    noteExpiredListings()
      .then((count) => {
        if (count > 0) logger.info({ count }, 'Left notes for expired web places')
      })
      .catch((error) => logError('Web place sweep failed', error))
  }, SWEEP_INTERVAL_MS)
  timer.unref?.()
}
