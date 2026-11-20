import { createSharedComposable } from '@vueuse/core'
import { i18n } from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { api } from '@/lib/api'
import { useLayersStore } from '@/stores/layers.store'
import { useHistoryStore } from '@/stores/history.store'
import type { Layer, LayerGroup } from '@/types/map.types'

interface ArchivableResource {
  id: string
  /** The resource's own URL, e.g. `/library/routes/<id>`. */
  path: string
  read: () => string | null | undefined
  write: (archivedAt: string | null) => void
}

export const useArchiveService = createSharedComposable(() => {
  // Not `useI18n`: services here are also reached outside component setup.
  const t = (key: string) => (i18n.global as any).t(key)

  /** Runs `apply`, and records it so it can be taken back. */
  async function withUndo(
    archived: boolean,
    apply: (archived: boolean) => Promise<void>,
  ) {
    try {
      await apply(archived)
      useHistoryStore().record({
        label: t(archived ? 'services.archive.archived' : 'services.archive.unarchived'),
        undoneLabel: t(archived ? 'services.archive.unarchived' : 'services.archive.archived'),
        undo: () => apply(!archived),
        redo: () => apply(archived),
      })
    } catch (error) {
      toast.error(t('services.archive.error'), { cause: error })
    }
  }

  /** Archives through the resource's `/archive` endpoint, optimistically. */
  function setArchived(resource: ArchivableResource, archived: boolean) {
    return withUndo(archived, async next => {
      const previous = resource.read() ?? null
      resource.write(next ? new Date().toISOString() : null)
      try {
        const url = `${resource.path}/archive`
        const { data } = next ? await api.put(url) : await api.delete(url)
        resource.write(data.archivedAt ?? null)
      } catch (error) {
        resource.write(previous)
        throw error
      }
    })
  }

  function setLayerArchived(item: Layer | LayerGroup, archived: boolean) {
    const kind = 'groupId' in item ? 'layer' : 'group'
    return withUndo(archived, next =>
      useLayersStore().setArchived(item.id, kind, next),
    )
  }

  return { setArchived, setLayerArchived }
})
