import { markRaw } from 'vue'
import { i18n } from '@/lib/i18n'
import { useAppService } from '@/services/app.service'
import type { ThemeColor } from '@/lib/utils'
import type { CreateCollectionParams, Collection } from '@/types/library.types'
import CollectionForm from './CollectionForm.vue'

/**
 * Opens the collection form and maps its result to service params. Callers that
 * built this object themselves drifted — creating from the list silently
 * dropped `iconPack`.
 */
export async function openCollectionDialog(
  collection?: Collection,
): Promise<CreateCollectionParams | null> {
  const t = (i18n.global as unknown as { t: (key: string) => string }).t
  const editing = Boolean(collection)

  const formData = await useAppService().componentDialog({
    component: markRaw(CollectionForm),
    title: t(
      editing
        ? 'library.dialog.editCollection.title'
        : 'library.dialog.createCollection.title',
    ),
    description: t(
      editing
        ? 'library.dialog.editCollection.description'
        : 'library.dialog.createCollection.description',
    ),
    continueText: t(editing ? 'general.save' : 'general.create'),
    cancelText: t('general.cancel'),
    props: collection ? { collection } : {},
  })

  if (!formData) return null

  return {
    name: formData.name,
    ...(formData.description ? { description: formData.description } : {}),
    icon: formData.icon,
    iconPack: formData.iconPack as 'lucide' | 'maki',
    iconColor: formData.iconColor as ThemeColor,
    isPublic: formData.isPublic,
  }
}
