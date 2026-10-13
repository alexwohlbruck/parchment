import { markRaw } from 'vue'
import { i18n } from '@/lib/i18n'
import { useAppService } from '@/services/app.service'
import { useCollectionGroupsService } from '@/services/library/collection-groups.service'
import { useCollectionGroupsStore } from '@/stores/library/collection-groups.store'
import { removeGroup } from '@/lib/library/collection-groups'
import { createCollectionFromDialog } from './collection-dialog'
import CollectionGroupForm from './CollectionGroupForm.vue'

const t = (i18n.global as unknown as { t: (key: string) => string }).t

async function groupForm(
  title: string,
  props: {
    groupId?: string
    parentId: string | null
    destinationOnly?: boolean
  },
  creating = false,
) {
  if (!useCollectionGroupsStore().editable) return null
  return useAppService().componentDialog({
    component: markRaw(CollectionGroupForm),
    title: t(title),
    continueText: t(creating ? 'general.create' : 'general.save'),
    props,
  })
}

export async function createCollectionGroup(parentId: string | null = null) {
  const result = await groupForm(
    'library.collections.groups.create',
    { parentId },
    true,
  )
  if (!result) return
  const store = useCollectionGroupsStore()
  await useCollectionGroupsService().saveOrganization({
    ...store.organization,
    groups: [
      ...store.organization.groups,
      { id: crypto.randomUUID(), name: result.name, parentId: result.parentId },
    ],
  })
}

export async function moveCollectionGroup(groupId: string) {
  const group = useCollectionGroupsStore().organization.groups.find(
    group => group.id === groupId,
  )
  if (!group) return
  const result = await groupForm('library.collections.groups.moveGroup', {
    groupId,
    parentId: group.parentId,
    destinationOnly: true,
  })
  if (result)
    await useCollectionGroupsService().updateGroup(groupId, {
      parentId: result.parentId,
    })
}

export async function moveCollectionToGroup(collectionId: string) {
  const store = useCollectionGroupsStore()
  const result = await groupForm('library.collections.groups.moveCollection', {
    parentId: store.collectionGroupIds.get(collectionId) ?? null,
    destinationOnly: true,
  })
  if (result)
    await useCollectionGroupsService().placeCollection(
      collectionId,
      result.parentId,
    )
}

export async function deleteCollectionGroup(groupId: string) {
  const store = useCollectionGroupsStore()
  if (!store.editable) return
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
  if (!useCollectionGroupsStore().editable) return
  const collection = await createCollectionFromDialog()
  if (collection)
    await useCollectionGroupsService().placeCollection(collection.id, groupId)
}
