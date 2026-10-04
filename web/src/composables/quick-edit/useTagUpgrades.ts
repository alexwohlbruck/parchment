import { computed, onUnmounted, ref, watch } from 'vue'
import { useQuickEditService } from '@/services/quick-edit.service'
import { useAbortController } from '@/composables/useAbortController'
import type { TagUpgrade } from '@/types/quick-edit.types'

const DEBOUNCE_MS = 400

/** Suggested updates for a feature's tags, re-checked as they are edited. */
export function useTagUpgrades(tags: Record<string, string>) {
  const quickEditService = useQuickEditService()
  const { nextSignal } = useAbortController()

  const latest = ref<TagUpgrade | null>(null)
  const ignored = ref(new Set<string>())

  const signature = (upgrade: TagUpgrade) => JSON.stringify(upgrade.changes)

  const upgrade = computed(() => {
    const value = latest.value
    if (!value?.changes.length || ignored.value.has(signature(value))) return null
    return value
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    () => JSON.stringify(tags),
    () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        try {
          latest.value = await quickEditService.suggestTagUpgrades(
            { ...tags },
            nextSignal(),
          )
        } catch {
          // Suggestions are optional; a failed check just shows none.
        }
      }, DEBOUNCE_MS)
    },
    { immediate: true },
  )
  onUnmounted(() => clearTimeout(timer))

  function ignore() {
    if (latest.value) ignored.value = new Set(ignored.value).add(signature(latest.value))
  }

  return { upgrade, ignore }
}
