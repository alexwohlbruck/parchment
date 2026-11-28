import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { APP_VERSION } from '@/lib/constants'
import { toast } from '@/lib/toast'
import { saveFile } from '@/lib/file-save'
import { packageExport } from '@/lib/data-export/export-archive'
import type { ExportData, ExportModuleId } from '@/lib/data-export/export-format'
import {
  exportAccount,
  exportBookmark,
  exportCanvas,
  exportCollection,
  exportIntegration,
  exportRoute,
  isCanvasLocked,
  isCollectionLocked,
  isRouteLocked,
  isNameLocked,
  type ExportIssue,
} from '@/lib/data-export/export-documents'
import { useAuthStore } from '@/stores/auth.store'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useRecentsStore } from '@/stores/recents.store'
import { useAuthService } from '@/services/auth.service'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useRoutesService } from '@/services/library/routes.service'
import { useIntegrationService } from '@/services/integration.service'
import { useLocationService } from '@/services/location.service'
import { useQuickEditService } from '@/services/quick-edit.service'
import { fetchPreferences } from '@/services/preferences.service'
import { getFriends, getInvitations } from '@/services/friends.service'
import { PermissionId } from '@/types/auth.types'
import type { Route, RouteBody } from '@/types/routes.types'

type Collector<M extends ExportModuleId> = (userId: string, report: (issue: ExportIssue) => void) => Promise<ExportData[M]>

/** Reports what this device can't decrypt, and returns the records it can export. */
function readable<T extends { id: string; name?: string | null; metadataEncrypted?: string | null }>(
  kind: ExportIssue['kind'],
  records: T[],
  isLocked: (record: T) => boolean,
  report: (issue: ExportIssue) => void,
): T[] {
  return records.filter(record => {
    const locked = isLocked(record)
    if (locked || isNameLocked(record)) report({ kind, id: record.id, reason: locked ? 'locked' : 'nameLocked' })
    return !locked
  })
}

/** Gathers the user's data module by module, decrypting on this device, and saves it as a file. */
export function useDataExport() {
  const { t } = useI18n()
  const exporting = ref(false)

  const authStore = useAuthStore()
  const vehiclesStore = useVehiclesStore()
  const recentsStore = useRecentsStore()
  const authService = useAuthService()
  const collectionsService = useCollectionsService()
  const bookmarksService = useBookmarksService()
  const canvasesService = useCanvasesService()
  const routesService = useRoutesService()
  const integrationService = useIntegrationService()
  const locationService = useLocationService()
  const quickEditService = useQuickEditService()

  const collectors: { [M in ExportModuleId]: Collector<M> } = {
    async library(userId, report) {
      const [collections, bookmarks, canvases] = await Promise.all([
        collectionsService.loadCollections(),
        bookmarksService.loadBookmarks(),
        canvasesService.loadCanvases(),
      ])
      const owned = readable('collection', collections.filter(c => c.userId === userId), isCollectionLocked, report)
      const exported = await Promise.all(
        owned.map(async c =>
          exportCollection(c, c.scheme === 'user-e2ee' ? await collectionsService.fetchAndDecryptPoints(c) : undefined),
        ),
      )
      const collectionIds = new Set(exported.map(c => c.id))
      const ownCanvases = readable('canvas', canvases.filter(c => c.userId === userId), isCanvasLocked, report)

      return {
        collections: exported,
        bookmarks: bookmarks
          .filter(b => b.userId === userId)
          .map(exportBookmark)
          .map(b => ({ ...b, collectionIds: b.collectionIds.filter(id => collectionIds.has(id)) })),
        canvases: ownCanvases.map(exportCanvas),
      }
    },

    async routes(userId, report) {
      const own = (await routesService.loadRoutes()).filter(r => r.userId === userId)
      const routes = readable('route', own, isRouteLocked, report) as (Route & { body: RouteBody })[]
      return { routes: routes.map(exportRoute) }
    },

    async vehicles() {
      await vehiclesStore.fetchVehicles()
      if (vehiclesStore.error) throw new Error(vehiclesStore.error)
      return { vehicles: vehiclesStore.vehicles }
    },

    async preferences() {
      const preferences = await fetchPreferences()
      if (!preferences) throw new Error('Preferences unavailable')
      return preferences
    },

    async history() {
      await Promise.all([recentsStore.ensureSearchesHydrated(), recentsStore.ensurePlacesHydrated()])
      return { searches: recentsStore.searches, places: recentsStore.places }
    },

    async friends() {
      const canShareLocation = authService.hasPermission(PermissionId.LOCATION_SHARING)
      const [friends, invitations, shares] = await Promise.all([
        getFriends(),
        getInvitations(),
        canShareLocation ? locationService.getE2eeConfigs() : [],
      ])
      return {
        friends: friends.map(f => ({
          handle: f.friendHandle,
          name: f.friendName,
          picture: f.friendPicture,
          establishedAt: f.establishedAt,
          createdAt: f.createdAt,
        })),
        invitations: invitations.map(({ fromHandle, toHandle, direction, status, createdAt, expiresAt }) => ({
          fromHandle,
          toHandle,
          direction,
          status,
          createdAt,
          expiresAt,
        })),
        locationSharing: shares.map(s => ({
          friendHandle: s.friendHandle,
          enabled: s.enabled,
          expiresAt: s.expiresAt?.toISOString() ?? null,
        })),
      }
    },

    async integrations(userId) {
      const records = (await integrationService.fetchConfiguredIntegrations()) ?? []
      return { integrations: records.filter(r => r.userId === userId).map(exportIntegration) }
    },

    async osmEdits() {
      return { edits: await quickEditService.getEditHistory() }
    },

    async account() {
      return exportAccount(authStore.me!)
    },
  }

  async function exportData(modules: ExportModuleId[]): Promise<boolean> {
    const userId = authStore.me?.id
    if (!userId || !modules.length || exporting.value) return false

    exporting.value = true
    const issues: ExportIssue[] = []
    try {
      const entries = await Promise.all(
        modules.map(async module => {
          const collector = collectors[module] as Collector<typeof module>
          return [module, await collector(userId, issue => issues.push(issue))] as const
        }),
      )
      const data = Object.fromEntries(entries) as Partial<ExportData>
      const { blob, filename } = packageExport(
        data,
        { exportedAt: new Date().toISOString(), appVersion: APP_VERSION },
        issues,
      )
      await saveFile(blob, filename)
      if (issues.length) toast.warning(t('dataExport.unreadable', { count: issues.length }, issues.length))
      return true
    } catch (error) {
      toast.error(t('dataExport.failed'), { cause: error })
      return false
    } finally {
      exporting.value = false
    }
  }

  return { exporting, exportData }
}
