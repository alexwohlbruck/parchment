import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { PowerSaver } from '@/types/power.types'

export const usePowerStore = defineStore('power', () => {
  const saver = ref<PowerSaver>('off')
  return { saver }
})
