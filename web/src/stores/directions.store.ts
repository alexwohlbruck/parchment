import { ref } from 'vue'
import { defineStore } from 'pinia'
import { Directions } from '@/types/directions.types'

export const useDirectionsStore = defineStore('directions', () => {
  const directions = ref<null | Directions>(null)

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function unsetDirections() {
    directions.value = null
  }

  return {
    directions,
    setDirections,
    unsetDirections,
  }
})
