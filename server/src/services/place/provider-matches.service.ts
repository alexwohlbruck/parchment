import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { placeProviderMatches } from '../../schema/place-provider-matches.schema'
import type { Source } from '../../lib/constants'
import type { MatchUpdate, ProviderIds } from '../../lib/place/provider-matches'

export async function getProviderMatches(
  source: Source,
  placeId: string,
): Promise<ProviderIds> {
  const rows = await db
    .select({
      provider: placeProviderMatches.provider,
      providerPlaceId: placeProviderMatches.providerPlaceId,
    })
    .from(placeProviderMatches)
    .where(
      and(
        eq(placeProviderMatches.source, source),
        eq(placeProviderMatches.placeId, placeId),
      ),
    )
  return Object.fromEntries(rows.map((row) => [row.provider, row.providerPlaceId]))
}

export async function applyProviderMatchUpdate(
  source: Source,
  placeId: string,
  { upserts, removals }: MatchUpdate,
): Promise<void> {
  const entries = Object.entries(upserts) as [Source, string][]
  if (entries.length) {
    const matchedAt = new Date()
    for (const [provider, providerPlaceId] of entries) {
      await db
        .insert(placeProviderMatches)
        .values({ source, placeId, provider, providerPlaceId, matchedAt })
        .onConflictDoUpdate({
          target: [
            placeProviderMatches.source,
            placeProviderMatches.placeId,
            placeProviderMatches.provider,
          ],
          set: { providerPlaceId, matchedAt },
        })
    }
  }
  if (removals.length) {
    await db
      .delete(placeProviderMatches)
      .where(
        and(
          eq(placeProviderMatches.source, source),
          eq(placeProviderMatches.placeId, placeId),
          inArray(placeProviderMatches.provider, removals),
        ),
      )
  }
}
