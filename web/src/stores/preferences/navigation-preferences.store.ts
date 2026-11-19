import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { jsonSerializer } from '@/lib/storage-serializer'
import {
  DEFAULT_SPEECH_PREFERENCES,
  DEFAULT_TRANSIT_BUFFER_MINUTES,
  defaultRoutingPreferences,
  mergeGuidancePreferences,
  mergeSpeechPreferences,
  parseRoutingPreferences,
  runPaceFactor,
  withModeEnabled,
  type ModeKey,
  type NavigationPreferences,
  type RoutingPreferenceSlices,
} from '@/lib/preferences/navigation-preferences'
import { DEFAULT_GUIDANCE_PREFERENCES } from '@/lib/guidance/guidance-preferences'
import type { RoutingPreferences, SortPreference, TripModeToken } from '@/types/multimodal.types'
import { saveNavigationPreferences } from '@/services/preferences.service'
import { useAccountSync } from './account-sync'

/**
 * Trip planning and guidance preferences. Every value is kept on the device;
 * once `adopt` has loaded the account's copy, changes are saved back to it.
 */
export const useNavigationPreferencesStore = defineStore('navigationPreferences', () => {
  const excludedModes = useStorage<TripModeToken[]>('excluded-modes', [])
  const sortPreference = useStorage<SortPreference | null>('trip-sort-preference', null, undefined, {
    serializer: jsonSerializer,
  })
  const routing = useStorage<RoutingPreferenceSlices>('routingPreferences', defaultRoutingPreferences(), undefined, {
    serializer: { read: raw => parseRoutingPreferences(jsonSerializer.read(raw)), write: JSON.stringify },
  })
  const speech = useStorage('speech-preferences', structuredClone(DEFAULT_SPEECH_PREFERENCES), undefined, {
    mergeDefaults: true,
  })
  const guidance = useStorage('guidance-preferences', structuredClone(DEFAULT_GUIDANCE_PREFERENCES), undefined, {
    mergeDefaults: true,
  })

  const transitBufferMinutes = computed(
    () => routing.value.mode.transit.transitBufferMinutes ?? DEFAULT_TRANSIT_BUFFER_MINUTES,
  )

  const runPace = computed(() => runPaceFactor(routing.value))

  const isModeEnabled = (token: TripModeToken) => !excludedModes.value.includes(token)

  function setModeEnabled(token: TripModeToken, enabled: boolean) {
    excludedModes.value = withModeEnabled(excludedModes.value, token, enabled)
  }

  function setGeneralPreference<K extends keyof RoutingPreferences>(key: K, value: RoutingPreferences[K]) {
    routing.value = { ...routing.value, general: { ...routing.value.general, [key]: value } }
  }

  function setModePreference<K extends keyof RoutingPreferences>(
    mode: ModeKey,
    key: K,
    value: RoutingPreferences[K],
  ) {
    const slices = routing.value.mode
    routing.value = { ...routing.value, mode: { ...slices, [mode]: { ...slices[mode], [key]: value } } }
  }

  const sync = useAccountSync<Required<NavigationPreferences>>(
    {
      excludedModes: () => excludedModes.value,
      sortPreference: () => sortPreference.value,
      routing: () => routing.value,
      speech: () => speech.value,
      guidance: () => guidance.value,
    },
    saveNavigationPreferences,
  )

  function adopt(remote: NavigationPreferences) {
    sync.adopt(remote, () => {
      if (remote.excludedModes) excludedModes.value = [...remote.excludedModes]
      if (remote.sortPreference !== undefined) sortPreference.value = remote.sortPreference
      if (remote.routing) routing.value = parseRoutingPreferences(remote.routing)
      if (remote.speech) speech.value = mergeSpeechPreferences(remote.speech)
      if (remote.guidance) guidance.value = mergeGuidancePreferences(remote.guidance)
    })
  }

  return {
    excludedModes,
    sortPreference,
    routing,
    speech,
    guidance,
    transitBufferMinutes,
    runPace,
    isModeEnabled,
    setModeEnabled,
    setGeneralPreference,
    setModePreference,
    adopt,
  }
})
