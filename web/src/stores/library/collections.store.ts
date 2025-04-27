import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import type { Collection } from '@/types/library.types'

export const useCollectionsStore = defineStore('collections', () => {
  const collections = useStorage<Collection[]>('collections', [])

  const getCollectionById = computed(() => {
    return (id: string) =>
      collections.value.find(collection => collection.id === id)
  })

  function setCollections(newCollections: Collection[]) {
    collections.value = newCollections
  }

  function addCollection(collection: Collection) {
    collections.value = [...collections.value, collection]
  }

  function updateCollection(id: string, updatedCollection: Collection) {
    const index = collections.value.findIndex(
      collection => collection.id === id,
    )
    if (index !== -1) {
      collections.value[index] = updatedCollection
    }
  }

  function removeCollection(id: string) {
    collections.value = collections.value.filter(
      collection => collection.id !== id,
    )
  }

  return {
    collections,
    getCollectionById,
    setCollections,
    addCollection,
    updateCollection,
    removeCollection,
  }
})
