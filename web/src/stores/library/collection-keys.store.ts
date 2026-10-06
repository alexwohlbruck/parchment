/**
 * Keys to private collections other people shared with this user, opened
 * from their share envelopes. Session-only, like the decrypted points: a key
 * on disk would hand the collection to anyone with the device.
 */
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export interface SharedCollectionKey {
  key: Uint8Array
  version: number
}

export const useCollectionKeysStore = defineStore('collection-keys', () => {
  const keys = shallowRef<Record<string, SharedCollectionKey>>({})

  function get(collectionId: string): SharedCollectionKey | undefined {
    return keys.value[collectionId]
  }

  function set(collectionId: string, key: SharedCollectionKey) {
    keys.value = { ...keys.value, [collectionId]: key }
  }

  function clear() {
    keys.value = {}
  }

  return { get, set, clear }
})
