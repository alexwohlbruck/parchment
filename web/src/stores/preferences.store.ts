import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { STORAGE_KEYS } from '@/lib/storage'
import { UnitSystem, FloorNumbering } from '@/types/map.types'

interface PreferencesState {
  unitSystem: UnitSystem
  floorNumbering: FloorNumbering
}

export const usePreferencesStore = defineStore('preferences', () => {
  const state = useStorage<PreferencesState>(STORAGE_KEYS.PREFERENCES, {
    unitSystem: UnitSystem.METRIC,
    floorNumbering: FloorNumbering.ZERO_BASED,
  })

  const unitSystem = computed({
    get: () => state.value.unitSystem,
    set: (v: UnitSystem) => { state.value.unitSystem = v },
  })

  const floorNumbering = computed({
    get: () => state.value.floorNumbering,
    set: (v: FloorNumbering) => { state.value.floorNumbering = v },
  })

  return {
    unitSystem,
    floorNumbering,
  }
})
