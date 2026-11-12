import { createSharedComposable } from '@vueuse/core'
import { i18n } from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { api } from '@/lib/api'
import { useLayersStore } from '@/stores/layers.store'
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

  /** Runs `apply`, then offers to undo it. */
  async function withUndo(
    id: string,
    archived: boolean,
    apply: (archived: boolean) => Promise<void>,
  ) {
    try {
      await apply(archived)
      toast.success(t(archived ? 'services.archive.archived' : 'services.archive.unarchived'), {
        id: `archive:${id}`,
        action: {
          label: t('general.undo'),
          onClick: () => withUndo(id, !archived, apply),
        },
      })
    } catch (error) {
      toast.error(t('services.archive.error'), { cause: error })
    }
  }

  /** Archives through the resource's `/archive` endpoint, optimistically. */
  function setArchived(resource: ArchivableResource, archived: boolean) {
    return withUndo(resource.id, archived, async next => {
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
    return withUndo(item.id, archived, next =>
      useLayersStore().setArchived(item.id, kind, next),
    )
  }

  return { withUndo, setArchived, setLayerArchived }
})
