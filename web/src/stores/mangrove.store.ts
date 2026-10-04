import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { jsonSerializer } from '@/lib/storage-serializer'
import type { MangroveSession } from '@/services/place/mangrove-review.service'

/** The person's session with Mangrove's signer, which signs reviews for them. */
export const useMangroveStore = defineStore('mangrove', () => {
  const session = useStorage<MangroveSession | null>(
    'mangrove-session',
    null,
    undefined,
    { serializer: jsonSerializer },
  )

  const activeSession = computed(() =>
    session.value && session.value.expiresAt > Date.now() ? session.value : null,
  )

  function setSession(value: MangroveSession) {
    session.value = value
  }

  /** Drops the signing token but keeps who the reviewer is, to find their reviews. */
  function expireSession() {
    if (session.value) session.value = { ...session.value, expiresAt: 0 }
  }

  return { session, activeSession, setSession, expireSession }
})
