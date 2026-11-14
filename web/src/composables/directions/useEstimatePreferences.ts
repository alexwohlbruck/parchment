import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { ESTIMATE_MODES } from '@server/lib/directions/mode-estimates'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'

/** Each estimable mode's routing preferences, merged over the general ones. */
export function useEstimatePreferences() {
  const { routing } = storeToRefs(useNavigationPreferencesStore())
  return computed(() =>
    Object.fromEntries(ESTIMATE_MODES.map(mode => [mode, { ...routing.value.general, ...routing.value.mode[mode] }])))
}
