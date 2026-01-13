import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useLocationStore = defineStore('location', () => {
  // ============================================================================
  // State
  // ============================================================================

  // Location sharing enabled
  const sharingEnabled = ref(false)

  // ============================================================================
  // Actions
  // ============================================================================

  function setSharingEnabled(enabled: boolean) {
    sharingEnabled.value = enabled
  }

  return {
    // State
    sharingEnabled,

    // Actions
    setSharingEnabled,
  }
})
