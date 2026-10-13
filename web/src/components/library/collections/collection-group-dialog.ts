import { markRaw } from 'vue'
import { i18n } from '@/lib/i18n'
import { useAppService } from '@/services/app.service'
import { useCollectionGroupsService } from '@/services/library/collection-groups.service'
import { useCollectionGroupsStore } from '@/stores/library/collection-groups.store'
import { removeGroup } from '@/lib/library/collection-groups'
import { createCollectionFromDialog } from './collection-dialog'
import CollectionGroupForm from './CollectionGroupForm.vue'

const t = (i18n.global as unknown as { t: (key: string) => string }).t

export async function editCollectionGroup(
  groupId?: string,
  parentId: string | null = null,
) {
  const store = useCollectionGroupsStore()
  if (!store.editable) return
  const group = store.organization.groups.find(group => group.id === groupId)
  const result = await useAppService().componentDialog({
    component: markRaw(CollectionGroupForm),
    title: t(
      group
        ? 'library.collections.groups.edit'
        : 'library.collections.groups.create',
    ),
    continueText: t(group ? 'general.save' : 'general.create'),
    props: {
      groupId,
      name: group?.name,
      parentId: group?.parentId ?? parentId,
    },
  })
  if (!result) return
  const updated = {
    id: groupId ?? crypto.randomUUID(),
    name: result.name,
    parentId: result.parentId,
  }
  await useCollectionGroupsService().saveOrganization({
    ...store.organization,
    groups: group
      ? store.organization.groups.map(item =>
          item.id === groupId ? updated : item,
        )
      : [...store.organization.groups, updated],
  })
}

export async function moveCollectionToGroup(collectionId: string) {
  const store = useCollectionGroupsStore()
  if (!store.editable) return
  const result = await useAppService().componentDialog({
    component: markRaw(CollectionGroupForm),
    title: t('library.collections.groups.moveCollection'),
    continueText: t('general.save'),
    props: {
      destinationOnly: true,
      parentId:
        store.organization.placements.find(
          item => item.collectionId === collectionId,
        )?.groupId ?? null,
    },
  })
  if (!result) return
  await useCollectionGroupsService().placeCollection(
    collectionId,
    result.parentId,
  )
}

export async function deleteCollectionGroup(groupId: string) {
  const store = useCollectionGroupsStore()
  const confirmed = await useAppService().confirm({
    title: t('library.collections.groups.remove'),
    description: t('library.collections.groups.removeDescription'),
    continueText: t('general.delete'),
    destructive: true,
  })
  if (confirmed)
    await useCollectionGroupsService().saveOrganization(
      removeGroup(store.organization, groupId),
    )
}

export async function createCollectionInGroup(groupId: string) {
  const collection = await createCollectionFromDialog()
  if (collection)
    await useCollectionGroupsService().placeCollection(collection.id, groupId)
}
