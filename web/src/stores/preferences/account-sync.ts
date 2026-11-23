import { ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useAuthStore } from '@/stores/auth.store'
import { overlayPaths, sameValue } from '@/lib/preferences/sync-scope'
import { useDeviceOnlyStore } from './device-only.store'

const SAVE_DEBOUNCE_MS = 800

/**
 * Saves each section to the account as it changes on this device. Nothing is
 * sent until `adopt` has taken the account's copy. Paths the device keeps to
 * itself (see `useDeviceOnlyStore`) are neither sent nor taken.
 */
export function useAccountSync<T extends object>(
  scope: string,
  sources: Record<keyof T, () => unknown>,
  save: (patch: Partial<T>) => Promise<unknown>,
) {
  type Section = keyof T
  const sectionNames = Object.keys(sources) as Section[]
  const deviceOnly = useDeviceOnlyStore()

  const linked = ref(false)
  let adopting = false
  let pending: Partial<T> = {}
  let account: Partial<T> = {}
  const sent: Partial<Record<Section, string>> = {}
  /** Bumped on sign-out so a save in flight can't requeue into the next account. */
  let session = 0

  const devicePaths = (section: Section) => deviceOnly.pathsWithin(`${scope}.${String(section)}`)

  const flush = useDebounceFn(async () => {
    const patch = pending
    const queuedIn = session
    pending = {}
    if (!Object.keys(patch).length) return
    try {
      await save(patch)
      if (queuedIn === session) account = { ...account, ...patch }
    } catch {
      if (queuedIn === session) pending = { ...patch, ...pending }
    }
  }, SAVE_DEBOUNCE_MS)

  function queue(section: Section) {
    const value = overlayPaths(sources[section](), account[section], devicePaths(section))
    if (value === undefined || sameValue(value, account[section])) {
      const { [section]: _, ...rest } = pending
      pending = rest as Partial<T>
      return
    }
    pending = { ...pending, [section]: JSON.parse(JSON.stringify(value)) }
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

    watch(() => devicePaths(section).join(), () => {
      if (linked.value) queue(section)
    })
  }

  /**
   * Runs `apply` with the account's values, this device's standing in for any
   * it keeps to itself, then seeds the account with this device's for any
   * section it never saved.
   */
  function adopt(remote: Partial<T>, apply: (values: Partial<T>) => void) {
    account = { ...remote }
    const values = Object.fromEntries(
      sectionNames.map(section => [section, overlayPaths(remote[section], sources[section](), devicePaths(section))]),
    ) as Partial<T>
    adopting = true
    try {
      apply(values)
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
    account = {}
    session++
  })

  return { adopt }
}
