/**
 * Turning the records the app holds into the export's shapes: decrypted
 * fields kept, ciphertext, share tokens and credentials left out.
 */

import type { Bookmark, Collection, DecryptedPoint } from '@/types/library.types'
import type { Canvas } from '@/types/canvas.types'
import type { Route } from '@/types/routes.types'
import type { User } from '@/types/auth.types'
import type { IntegrationRecord } from '@/types/integrations.types'
import type {
  ExportedAccount,
  ExportedBookmark,
  ExportedCanvas,
  ExportedCollection,
  ExportedIntegration,
  ExportedRoute,
} from '@/lib/data-export/export-format'

/**
 * Something this device couldn't decrypt: `locked` was left out, `nameLocked`
 * was exported without its name, icon and description.
 */
export interface ExportIssue {
  kind: 'collection' | 'canvas' | 'route'
  id: string
  reason: 'locked' | 'nameLocked'
}

const display = (record: {
  name?: string | null
  description?: string | null
  icon?: string | null
  iconPack?: 'lucide' | 'maki' | null
  iconColor?: string | null
}) => ({
  name: record.name ?? null,
  description: record.description ?? null,
  icon: record.icon ?? null,
  iconPack: record.iconPack ?? null,
  iconColor: record.iconColor ?? null,
})

const timestamps = (record: { createdAt: string; updatedAt: string; archivedAt?: string | null }) => ({
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  archivedAt: record.archivedAt ?? null,
})

export function exportCollection(
  collection: Collection,
  points?: DecryptedPoint[],
): ExportedCollection {
  return {
    id: collection.id,
    scheme: collection.scheme,
    isPublic: collection.isPublic,
    resharingPolicy: collection.resharingPolicy,
    ...display(collection),
    ...timestamps(collection),
    ...(collection.scheme === 'user-e2ee' ? { points: points ?? [] } : {}),
  }
}

export function exportBookmark(bookmark: Bookmark): ExportedBookmark {
  const { userId: _userId, ...rest } = bookmark
  return { ...rest, collectionIds: bookmark.collectionIds ?? [] }
}

export function exportCanvas(canvas: Canvas): ExportedCanvas {
  return {
    id: canvas.id,
    scheme: canvas.scheme,
    isPublic: canvas.isPublic,
    ...display(canvas),
    ...timestamps(canvas),
    body: canvas.body ?? null,
  }
}

export function exportRoute(route: Route & { body: NonNullable<Route['body']> }): ExportedRoute {
  return {
    id: route.id,
    scheme: route.scheme,
    mode: route.mode,
    isPublic: route.isPublic,
    ...display(route),
    ...timestamps(route),
    body: route.body,
  }
}

export const isCollectionLocked = (collection: Collection) => !!collection.locked

export const isCanvasLocked = (canvas: Canvas) =>
  !!canvas.undecryptable || (canvas.scheme === 'user-e2ee' && !canvas.body)

export const isRouteLocked = (route: Route): boolean => !route.body

/** Needs the user's own key to read: an end-to-end encrypted record, or one with a sealed name. */
export const isPrivate = (record: { scheme?: string | null; metadataEncrypted?: string | null }) =>
  record.scheme === 'user-e2ee' || !!record.metadataEncrypted

export const isNameLocked = (record: { metadataEncrypted?: string | null; name?: string | null }) =>
  !!record.metadataEncrypted && record.name == null

const CREDENTIAL_KEY = /secret|token|password|passphrase|api.?key|credential|private.?key|auth/i

/** A config with every credential-like field removed, however deep. */
export function withoutCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCredentials)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !CREDENTIAL_KEY.test(key))
      .map(([key, inner]) => [key, withoutCredentials(inner)]),
  )
}

export function exportIntegration(record: IntegrationRecord): ExportedIntegration {
  return {
    id: record.id,
    integrationId: record.integrationId,
    scheme: record.scheme,
    config: withoutCredentials(record.config ?? {}) as Record<string, unknown>,
    capabilities: record.capabilities.map(({ id, active }) => ({ id, active })),
  }
}

export function exportAccount(user: User): ExportedAccount {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    alias: user.alias ?? null,
    picture: user.picture ?? null,
  }
}
