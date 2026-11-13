import { useI18n } from 'vue-i18n'
import { useAppService } from '@/services/app.service'
import { useLayersStore } from '@/stores/layers.store'

type Deletable = { id: string; name: string }

/** Confirm, then delete a layer or a layer group from the library. */
export function useLayerDelete() {
  const { t } = useI18n()
  const appService = useAppService()
  const layersStore = useLayersStore()

  function confirmDelete(name: string, description?: string) {
    return appService.confirm({
      title: t('layers.delete.title', { name }),
      description,
      continueText: t('general.delete'),
      cancelText: t('general.cancel'),
      destructive: true,
    })
  }

  async function deleteLayer(layer: Deletable) {
    if (!(await confirmDelete(layer.name))) return
    await layersStore.removeLayer(layer.id)
  }

  async function deleteGroup(group: Deletable) {
    if (!(await confirmDelete(group.name, t('layers.delete.groupDescription')))) return
    await layersStore.removeLayerGroup(group.id)
  }

  return { deleteLayer, deleteGroup }
}
