import { ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useAuthStore } from '@/stores/auth.store'

const SAVE_DEBOUNCE_MS = 800

/**
 * Saves each section to the account as it changes on this device. Nothing is
 * sent until `adopt` has taken the account's copy.
 */
export function useAccountSync<T extends object>(
  sources: Record<keyof T, () => unknown>,
  save: (patch: Partial<T>) => Promise<unknown>,
) {
  type Section = keyof T
  const sectionNames = Object.keys(sources) as Section[]

  const linked = ref(false)
  let adopting = false
  let pending: Partial<T> = {}
  const sent: Partial<Record<Section, string>> = {}
  /** Bumped on sign-out so a save in flight can't requeue into the next account. */
  let session = 0

  const flush = useDebounceFn(async () => {
    const patch = pending
    const queuedIn = session
    pending = {}
    if (!Object.keys(patch).length) return
    try {
      await save(patch)
    } catch {
      if (queuedIn === session) pending = { ...patch, ...pending }
    }
  }, SAVE_DEBOUNCE_MS)

  function queue(section: Section) {
    pending = { ...pending, [section]: sources[section]() }
    void flush()
  }

  for (const section of sectionNames) {
    watch(sources[section], value => {
      if (!linked.value || adopting) return
      const snapshot = JSON.stringify(value)
      if (snapshot === sent[section]) return
      sent[section] = snapshot
      queue(section)
    }, { deep: true, flush: 'sync' })
  }

  /** Runs `apply` to take the account's values, then seeds the account with this device's for any section it never saved. */
  function adopt(remote: Partial<T>, apply: () => void) {
    adopting = true
    try {
      apply()
    } finally {
      adopting = false
    }
    for (const section of sectionNames) sent[section] = JSON.stringify(sources[section]())
    linked.value = true
    sectionNames.filter(section => remote[section] === undefined).forEach(queue)
  }

  const authStore = useAuthStore()
  watch(() => authStore.me, me => {
    if (me) return
    linked.value = false
    pending = {}
    session++
  })

  return { adopt }
}
