/**
 * Decrypted points of `user-e2ee` collections, keyed by collection id.
 *
 * Deliberately NOT persisted. Every other library store caches to
 * localStorage for instant paint, but these are plaintext copies of data the
 * server is not allowed to read — writing them to disk would undo the
 * collection's encryption for anyone with access to the device. They are
 * re-fetched and re-decrypted each session, on demand, when a collection's
 * layer is switched on.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DecryptedPoint } from '@/types/library.types'

export const useEncryptedPointsStore = defineStore('encrypted-points', () => {
  const pointsByCollection = ref<Record<string, DecryptedPoint[]>>({})
  /** Collections already fetched this session, successful or empty. */
  const loaded = ref<Set<string>>(new Set())
  /** In-flight fetches, so concurrent toggles don't decrypt twice. */
  const loading = ref<Set<string>>(new Set())

  function getPoints(collectionId: string): DecryptedPoint[] {
    return pointsByCollection.value[collectionId] ?? []
  }

  function isLoaded(collectionId: string): boolean {
    return loaded.value.has(collectionId)
  }

  function isLoading(collectionId: string): boolean {
    return loading.value.has(collectionId)
  }

  function beginLoad(collectionId: string) {
    loading.value = new Set(loading.value).add(collectionId)
  }

  function setPoints(collectionId: string, points: DecryptedPoint[]) {
    pointsByCollection.value = {
      ...pointsByCollection.value,
      [collectionId]: points,
    }
    loaded.value = new Set(loaded.value).add(collectionId)
    endLoad(collectionId)
  }

  function endLoad(collectionId: string) {
    const next = new Set(loading.value)
    next.delete(collectionId)
    loading.value = next
  }

  /**
   * Drop a collection's plaintext. Called when its scheme changes or its key
   * rotates, so stale decrypts can't linger past the change.
   */
  function clearCollection(collectionId: string) {
    const { [collectionId]: _dropped, ...rest } = pointsByCollection.value
    pointsByCollection.value = rest
    const nextLoaded = new Set(loaded.value)
    nextLoaded.delete(collectionId)
    loaded.value = nextLoaded
    endLoad(collectionId)
  }

  /** Wipe everything — sign-out, identity reset, device revocation. */
  function clear() {
    pointsByCollection.value = {}
    loaded.value = new Set()
    loading.value = new Set()
  }

  return {
    pointsByCollection,
    getPoints,
    isLoaded,
    isLoading,
    beginLoad,
    setPoints,
    endLoad,
    clearCollection,
    clear,
  }
})
