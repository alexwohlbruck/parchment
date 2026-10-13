import { beforeEach, it, expect, vi } from 'vitest'
import { reactive, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useCollectionGroupsStore } from '@/stores/library/collection-groups.store'
import { useCollectionGroupsService } from './collection-groups.service'
import type { CollectionOrganization } from '@/types/collection-groups.types'
import { isOffline } from '@/lib/connectivity'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
const toast = vi.hoisted(() => ({ error: vi.fn() }))
const auth = reactive({ me: { id: 'alice' } as { id: string } | null })
vi.mock('@/lib/api', () => ({ api }))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('@/lib/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => auth }))
vi.mock('@/lib/connectivity', async () => {
  const { ref } = await import('vue')
  return { isOffline: ref(false) }
})

const value: CollectionOrganization = {
  revision: 1,
  groups: [{ id: 'ny', name: 'New York', parentId: null }],
  placements: [{ collectionId: 'parks', groupId: 'ny' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
  auth.me = { id: 'alice' }
  ;(isOffline as unknown as { value: boolean }).value = false
  api.get.mockResolvedValue({ data: value })
  api.put.mockImplementation(async (_url, organization) => ({
    data: { ...organization, revision: organization.revision + 1 },
  }))
})

it('keeps cached layouts scoped to each account', async () => {
  const store = useCollectionGroupsStore()
  await useCollectionGroupsService().fetchOrganization()
  expect(store.organization).toEqual(value)
  expect(store.editable).toBe(true)
  auth.me = { id: 'bob' }
  expect(store.organization.groups).toEqual([])
  expect(store.editable).toBe(false)
  auth.me = null
  expect(store.organization.groups).toEqual([])
  auth.me = { id: 'alice' }
  expect(store.organization).toEqual(value)
})

it('preserves cached groups offline and disables writes', async () => {
  const store = useCollectionGroupsStore()
  const service = useCollectionGroupsService()
  await service.fetchOrganization()
  ;(isOffline as unknown as { value: boolean }).value = true
  expect(store.organization).toEqual(value)
  expect(store.editable).toBe(false)
  expect(await service.placeCollection('parks', null)).toBe(false)
  expect(api.put).not.toHaveBeenCalled()
  await nextTick()
  expect(JSON.parse(localStorage.getItem('collection-groups')!).alice).toEqual(
    value,
  )
})

it('updates placement without overwriting other collections and can ungroup', async () => {
  const service = useCollectionGroupsService()
  const store = useCollectionGroupsStore()
  await service.fetchOrganization()
  await service.placeCollection('restaurants', 'ny')
  expect(store.organization.placements).toEqual([
    ...value.placements,
    { collectionId: 'restaurants', groupId: 'ny' },
  ])
  await service.placeCollection('parks', null)
  expect(store.organization.placements).toEqual([
    { collectionId: 'restaurants', groupId: 'ny' },
  ])
  expect(store.organization.revision).toBe(3)
})

it('reloads on a revision conflict and retains server groups on a failed save', async () => {
  const service = useCollectionGroupsService()
  const store = useCollectionGroupsStore()
  await service.fetchOrganization()
  const newer = {
    ...value,
    revision: 5,
    groups: [{ id: 'ny', name: 'Renamed elsewhere', parentId: null }],
  }
  api.put.mockRejectedValue({ response: { status: 409 } })
  api.get.mockResolvedValue({ data: newer })
  expect(await service.placeCollection('parks', null)).toBe(false)
  expect(store.organization).toEqual(newer)
  expect(toast.error).toHaveBeenCalledWith(
    'library.collections.groups.conflict',
  )
  expect(store.saving).toBe(false)
})

it('does not let a delayed read replace a completed save', async () => {
  const service = useCollectionGroupsService()
  const store = useCollectionGroupsStore()
  await service.fetchOrganization()
  let resolveRead!: (response: { data: CollectionOrganization }) => void
  api.get.mockReturnValue(
    new Promise(resolve => {
      resolveRead = resolve
    }),
  )
  const pendingRead = service.fetchOrganization()
  await service.placeCollection('parks', null)
  resolveRead({ data: value })
  await pendingRead
  expect(store.organization.revision).toBe(2)
  expect(store.organization.placements).toEqual([])
})

it('does not apply an old account’s response to a newly signed-in account', async () => {
  const service = useCollectionGroupsService()
  const store = useCollectionGroupsStore()
  let resolveRead!: (response: { data: CollectionOrganization }) => void
  api.get.mockReturnValue(
    new Promise(resolve => {
      resolveRead = resolve
    }),
  )
  const pendingRead = service.fetchOrganization()
  auth.me = { id: 'bob' }
  resolveRead({ data: value })
  await pendingRead
  expect(store.organization.groups).toEqual([])
  expect(store.editable).toBe(false)
  auth.me = { id: 'alice' }
  expect(store.organization).toEqual(value)
})
