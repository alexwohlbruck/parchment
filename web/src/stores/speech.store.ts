import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

export const useSpeechStore = defineStore('speech', () => {
  const preferences = useStorage('speech-preferences', {
    rate: 1,
    voices: {} as Record<string, string>,
  }, undefined, { mergeDefaults: true })
  return { preferences }
})
