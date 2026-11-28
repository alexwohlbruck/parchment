/**
 * The native export format: one self-describing JSON document per module,
 * versioned so an importer can tell exactly what it is reading.
 */

import type { Bookmark, DecryptedPoint, EncryptionScheme, ResharingPolicy } from '@/types/library.types'
import type { CanvasBody } from '@/types/canvas.types'
import type { RouteBody, RouteMode } from '@/types/routes.types'
import type { UserVehicle } from '@/types/multimodal.types'
import type { RecentPlaceEntry, RecentSearchEntry } from '@/lib/recents'
import type { OsmEdit } from '@server/schema/osm-edits.schema'
import type { UserPreferences } from '@/types/preferences.types'

export const EXPORT_FORMAT = 'parchment-export'
export const EXPORT_VERSION = 1

/** In the order the settings list shows them. */
export const EXPORT_MODULES = [
  'library',
  'routes',
  'vehicles',
  'preferences',
  'history',
  'friends',
  'integrations',
  'osmEdits',
  'account',
] as const

export type ExportModuleId = (typeof EXPORT_MODULES)[number]

interface Displayed {
  name: string | null
  description: string | null
  icon: string | null
  iconPack: 'lucide' | 'maki' | null
  iconColor: string | null
}

interface Timestamps {
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface ExportedCollection extends Displayed, Timestamps {
  id: string
  scheme: EncryptionScheme
  isPublic: boolean
  resharingPolicy: ResharingPolicy
  /** A private collection's places, which live with it rather than as bookmarks. */
  points?: DecryptedPoint[]
}

/** A saved place. `collectionIds` is most recently filed first. */
export type ExportedBookmark = Omit<Bookmark, 'userId'> & { collectionIds: string[] }

export interface ExportedCanvas extends Displayed, Timestamps {
  id: string
  scheme: EncryptionScheme
  isPublic: boolean
  body: CanvasBody | null
}

export interface ExportedRoute extends Displayed, Timestamps {
  id: string
  scheme: EncryptionScheme
  mode: RouteMode
  isPublic: boolean
  body: RouteBody
}

export interface ExportedFriend {
  handle: string
  name: string | null
  picture: string | null
  establishedAt: string | null
  createdAt: string
}

export interface ExportedInvitation {
  fromHandle: string
  toHandle: string
  direction: 'incoming' | 'outgoing'
  status: string
  createdAt: string
  expiresAt: string | null
}

export interface ExportedLocationShare {
  friendHandle: string
  enabled: boolean
  expiresAt: string | null
}

export interface ExportedIntegration {
  id: string
  integrationId: string
  scheme: EncryptionScheme
  /** Settings with every credential removed. */
  config: Record<string, unknown>
  capabilities: { id: string; active: boolean }[]
}

export interface ExportedAccount {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  alias: string | null
  picture: string | null
}

export interface ExportData {
  library: {
    collections: ExportedCollection[]
    bookmarks: ExportedBookmark[]
    canvases: ExportedCanvas[]
  }
  routes: { routes: ExportedRoute[] }
  vehicles: { vehicles: UserVehicle[] }
  preferences: UserPreferences
  history: { searches: RecentSearchEntry[]; places: RecentPlaceEntry[] }
  friends: {
    friends: ExportedFriend[]
    invitations: ExportedInvitation[]
    locationSharing: ExportedLocationShare[]
  }
  integrations: { integrations: ExportedIntegration[] }
  osmEdits: { edits: OsmEdit[] }
  account: ExportedAccount
}

export interface ExportDocument<M extends ExportModuleId = ExportModuleId> {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  module: M
  exportedAt: string
  appVersion: string
  data: ExportData[M]
}

export interface ExportMeta {
  exportedAt: string
  appVersion: string
}

export function exportDocument<M extends ExportModuleId>(
  module: M,
  data: ExportData[M],
  meta: ExportMeta,
): ExportDocument<M> {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, module, ...meta, data }
}

export function serializeDocument(document: ExportDocument): string {
  return JSON.stringify(document, null, 2) + '\n'
}

export class ExportFormatError extends Error {}

/** Parse a module document, refusing anything this version can't read. */
export function readExportDocument(text: string): ExportDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ExportFormatError('Not JSON')
  }
  const document = parsed as Partial<ExportDocument> | null
  if (document?.format !== EXPORT_FORMAT) throw new ExportFormatError('Not a Parchment export')
  if (typeof document.version !== 'number' || document.version > EXPORT_VERSION) {
    throw new ExportFormatError(`Unsupported export version ${document.version}`)
  }
  if (!EXPORT_MODULES.includes(document.module as ExportModuleId)) {
    throw new ExportFormatError(`Unknown module ${document.module}`)
  }
  if (document.data == null) throw new ExportFormatError('Missing data')
  return document as ExportDocument
}
