import { DialogOptions, DialogType } from '@/types/app.types'
import { defineStore } from 'pinia'
import { Component, computed, ref, watch } from 'vue'
import { useWindowSize } from '@vueuse/core'

import ComponentDialog from '@/components/dialogs/ComponentDialog.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import PromptDialog from '@/components/dialogs/PromptDialog.vue'
import AutoformDialog from '@/components/dialogs/AutoformDialog.vue'

export const useAppStore = defineStore('app', () => {
  const obstructingComponents = ref<Component[]>([])
  const { width: windowWidth, height: windowHeight } = useWindowSize()
  const forceRefresh = ref(0) // Counter to force recomputation

  // To use these, call the composable `useObstructingComponent`
  function trackObstructingComponents(component: Component) {
    obstructingComponents.value.push(component)
  }

  function untrackObstructingComponent(component: Component) {
    obstructingComponents.value = obstructingComponents.value.filter(
      c => c !== component,
    )
  }

  // Force a refresh of component positions
  function refreshObstructingComponents() {
    forceRefresh.value++
  }

  // Watch for window resize and refresh positions when it happens
  watch([windowWidth, windowHeight], () => {
    refreshObstructingComponents()
  })

  const visibleMapArea = computed(() => {
    console.log('refreshObstructingComponents')
    // Use forceRefresh as a dependency to ensure this is recalculated when needed
    const _ = forceRefresh.value

    // Get the current viewport dimensions from VueUse's reactive window size
    const viewportWidth = windowWidth.value
    const viewportHeight = windowHeight.value

    // Initialize with full viewport area
    let availableArea = {
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight,
    }

    // If no obstructing components, return full viewport
    if (obstructingComponents.value.length === 0) {
      return availableArea
    }

    // Get DOM elements for all obstructing components
    const obstacles = obstructingComponents.value
      .map(component => {
        try {
          // Access the DOM element - Vue components store this in various ways
          // Use type assertion as unknown first to avoid TypeScript errors
          const el = (component as unknown as { $el?: HTMLElement }).$el

          if (!el) return null

          // Get the bounding client rect with any transforms applied
          const rect = el.getBoundingClientRect()

          return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          }
        } catch (error) {
          console.error('Failed to get bounding rect for component', error)
          return null
        }
      })
      .filter(
        (
          obstacle,
        ): obstacle is {
          x: number
          y: number
          width: number
          height: number
        } => obstacle !== null,
      )

    // Find the largest rectangle that doesn't intersect with any obstacle
    // Start with full viewport and progressively reduce it
    for (const obstacle of obstacles) {
      // Skip if obstacle is entirely outside the viewport
      if (
        obstacle.x >= viewportWidth ||
        obstacle.y >= viewportHeight ||
        obstacle.x + obstacle.width <= 0 ||
        obstacle.y + obstacle.height <= 0
      ) {
        continue
      }

      // Calculate potential rectangles by splitting around the obstacle
      const potentialRects = [
        // Rectangle above the obstacle
        {
          x: availableArea.x,
          y: availableArea.y,
          width: availableArea.width,
          height: Math.max(0, obstacle.y - availableArea.y),
        },
        // Rectangle below the obstacle
        {
          x: availableArea.x,
          y: obstacle.y + obstacle.height,
          width: availableArea.width,
          height: Math.max(
            0,
            availableArea.y +
              availableArea.height -
              (obstacle.y + obstacle.height),
          ),
        },
        // Rectangle to the left of the obstacle
        {
          x: availableArea.x,
          y: availableArea.y,
          width: Math.max(0, obstacle.x - availableArea.x),
          height: availableArea.height,
        },
        // Rectangle to the right of the obstacle
        {
          x: obstacle.x + obstacle.width,
          y: availableArea.y,
          width: Math.max(
            0,
            availableArea.x +
              availableArea.width -
              (obstacle.x + obstacle.width),
          ),
          height: availableArea.height,
        },
      ]

      // Find the rectangle with the largest area
      const areas = potentialRects.map(rect => rect.width * rect.height)
      const maxAreaIndex = areas.indexOf(Math.max(...areas))

      // Update the available area
      if (maxAreaIndex !== -1 && areas[maxAreaIndex] > 0) {
        availableArea = potentialRects[maxAreaIndex]
      }
    }

    return availableArea
  })

  const dialogs = ref<
    {
      id: number
      component: Component
      props: any
      onSubmit: Function
    }[]
  >([])

  function createDialog(
    type: DialogType,
    options: DialogOptions,
  ): Promise<any> {
    return new Promise(resolve => {
      const id = new Date().getTime()
      const dialogTypesMap = {
        [DialogType.Component]: ComponentDialog,
        [DialogType.Confirm]: ConfirmDialog,
        [DialogType.Prompt]: PromptDialog,
        [DialogType.AutoForm]: AutoformDialog,
        [DialogType.Template]: ConfirmDialog, // TODO
      }

      dialogs.value.push({
        id,
        component: dialogTypesMap[type],
        props: options,
        onSubmit: (payload: any) => {
          if (payload) resolve(payload)
          setTimeout(() => removeDialog(id), 1000) // Wait for close animation
        },
      })
    })
  }

  function removeDialog(id: number) {
    const index = dialogs.value.findIndex(dialog => dialog.id === id)
    if (index !== -1) {
      dialogs.value.splice(index, 1)
    }
  }

  return {
    dialogs,
    createDialog,
    removeDialog,
    obstructingComponents,
    trackObstructingComponents,
    untrackObstructingComponent,
    visibleMapArea,
    refreshObstructingComponents,
  }
})
