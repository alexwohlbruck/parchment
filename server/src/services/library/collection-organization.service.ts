import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { collectionOrganizations } from '../../schema/collection-organization.schema'
import type { CollectionOrganization } from '../../types/library.types'
import { organizationError } from '../../lib/library/collection-groups'
import { getCollections, getSharedCollections } from './collections.service'

export class OrganizationValidationError extends Error {}
export class OrganizationConflictError extends Error {}

export async function getOrganization(
  userId: string,
): Promise<CollectionOrganization> {
  const [row] = await db
    .select()
    .from(collectionOrganizations)
    .where(eq(collectionOrganizations.userId, userId))
  return row
    ? { groups: row.groups, placements: row.placements, revision: row.revision }
    : { groups: [], placements: [], revision: 0 }
}

export async function saveOrganization(
  userId: string,
  organization: CollectionOrganization,
): Promise<CollectionOrganization> {
  const error = organizationError(organization)
  if (error) throw new OrganizationValidationError(error)
  const [owned, shared] = await Promise.all([
    getCollections(userId),
    getSharedCollections(userId),
  ])
  const accessible = new Set(
    [...owned, ...shared].map((collection) => collection.id),
  )
  const values = {
    groups: organization.groups.map((group) => ({
      ...group,
      name: group.name.trim(),
    })),
    placements: organization.placements.filter((placement) =>
      accessible.has(placement.collectionId),
    ),
    revision: organization.revision + 1,
  }
  return db.transaction(async (tx) => {
    await tx
      .insert(collectionOrganizations)
      .values({ userId })
      .onConflictDoNothing()
    const [row] = await tx
      .update(collectionOrganizations)
      .set(values)
      .where(
        and(
          eq(collectionOrganizations.userId, userId),
          eq(collectionOrganizations.revision, organization.revision),
        ),
      )
      .returning()
    if (!row)
      throw new OrganizationConflictError(
        'Collection groups changed on another device',
      )
    return {
      groups: row.groups,
      placements: row.placements,
      revision: row.revision,
    }
  })
}
