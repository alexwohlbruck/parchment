import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { providerListingLabels } from '../../schema/provider-listing-labels.schema'

export interface ListingLabel {
  name: string
  address: string | null
}

export async function getListingLabel(provider: string, providerPlaceId: string): Promise<ListingLabel | null> {
  const [row] = await db
    .select({ name: providerListingLabels.name, address: providerListingLabels.address })
    .from(providerListingLabels)
    .where(and(eq(providerListingLabels.provider, provider), eq(providerListingLabels.providerPlaceId, providerPlaceId)))
    .limit(1)
  return row ?? null
}

export async function saveListingLabel(provider: string, providerPlaceId: string, label: ListingLabel): Promise<void> {
  const name = label.name.trim().slice(0, 300)
  if (!name) return
  const address = label.address?.trim().slice(0, 500) || null
  await db
    .insert(providerListingLabels)
    .values({ provider, providerPlaceId, name, address, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [providerListingLabels.provider, providerListingLabels.providerPlaceId],
      set: { name, address, updatedAt: new Date() },
    })
}
