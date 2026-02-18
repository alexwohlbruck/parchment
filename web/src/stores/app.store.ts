import { DialogOptions, DialogType } from '@/types/app.types'
import { defineStore } from 'pinia'
import { Component, computed, ref, watch, markRaw } from 'vue'
import { useWindowSize, useStorage } from '@vueuse/core'
import { UnitSystem } from '@/types/map.types'

import ComponentDialog from '@/components/dialogs/ComponentDialog.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import PromptDialog from '@/components/dialogs/PromptDialog.vue'
import AutoformDialog from '@/components/dialogs/AutoformDialog.vue'
import ProgrammaticDrawer from '@/components/ProgrammaticDrawer.vue'

export interface ManualBounds {
  x: number
  y: number
  width: number
  height: number
}

export const useAppStore = defineStore('app', () => {
  const obstructingComponentsMap = ref<Map<string, Component>>(new Map())
  const manualBoundsMap = ref<Map<string, ManualBounds>>(new Map())
  const { width: windowWidth, height: windowHeight } = useWindowSize()
  const forceRefresh = ref(0)
  const debugObstructingComponents = ref(false)
  let nextId = 0

  // To use these, call the composable `useObstructingComponent`
  function trackObstructingComponent(component: Component) {
    const id = `auto_${nextId++}`
    obstructingComponentsMap.value.set(id, component)
    return id
  }

  function trackObstructingComponentWithKey(key: string, component: Component) {
    obstructingComponentsMap.value.set(key, component)
  }

  function getObstructingComponent(key: string) {
    return obstructingComponentsMap.value.get(key)
  }

  function untrackObstructingComponent(component: Component) {
    // Find and remove component from map
    for (const [key, comp] of obstructingComponentsMap.value.entries()) {
      if (comp === component) {
        obstructingComponentsMap.value.delete(key)
        manualBoundsMap.value.delete(key)
      }
    }
  }

  function updateManualBounds(key: string, bounds: ManualBounds) {
    manualBoundsMap.value.set(key, bounds)
    refreshObstructingComponents()
  }

  function clearManualBounds(key: string) {
    manualBoundsMap.value.delete(key)
    refreshObstructingComponents()
  }

  function refreshObstructingComponents() {
    forceRefresh.value++
  }

  watch([windowWidth, windowHeight], () => {
    refreshObstructingComponents()
  })

  const componentDimensions = computed(() => {
    const _ = forceRefresh.value
    const dimensions = new Map<
      string,
      { width: number; height: number; x: number; y: number }
    >()

    for (const [key, component] of obstructingComponentsMap.value.entries()) {
      // Check if this component has manual bounds first
      const manualBounds = manualBoundsMap.value.get(key)
      if (manualBounds) {
        dimensions.set(key, manualBounds)
        continue
      }

      // Otherwise, use automatic bounds detection
      try {
        const el = (component as unknown as { $el?: HTMLElement }).$el

        if (!el || !el.getBoundingClientRect) continue

        // Ensure it's actually a valid element
        if (typeof el.getBoundingClientRect !== 'function') {
          continue
        }

        const rect = el.getBoundingClientRect()
        dimensions.set(key, {
          width: rect.width,
          height: rect.height,
          x: rect.left,
          y: rect.top,
        })
      } catch (error) {
        console.error('Failed to get dimensions for component', key, error)
      }
    }

    return dimensions
  })

  // Helper function to calculate visible area given a list of bounds
  function calculateVisibleArea(
    obstacles: { x: number; y: number; width: number; height: number }[],
  ) {
    const viewportWidth = windowWidth.value
    const viewportHeight = windowHeight.value

    let availableArea = {
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight,
    }

    if (obstacles.length === 0) {
      return availableArea
    }

    for (const obstacle of obstacles) {
      if (
        obstacle.x >= viewportWidth ||
        obstacle.y >= viewportHeight ||
        obstacle.x + obstacle.width <= 0 ||
        obstacle.y + obstacle.height <= 0
      ) {
        continue
      }

      const potentialRects = [
        {
          x: availableArea.x,
          y: availableArea.y,
          width: availableArea.width,
          height: Math.max(0, obstacle.y - availableArea.y),
        },
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
        {
          x: availableArea.x,
          y: availableArea.y,
          width: Math.max(0, obstacle.x - availableArea.x),
          height: availableArea.height,
        },
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

      const areas = potentialRects.map(rect => rect.width * rect.height)
      const maxAreaIndex = areas.indexOf(Math.max(...areas))

      if (maxAreaIndex !== -1 && areas[maxAreaIndex] > 0) {
        availableArea = potentialRects[maxAreaIndex]
      }
    }

    return availableArea
  }

  const visibleMapArea = computed(() => {
    const _ = forceRefresh.value
    // Use all component dimensions
    const allBounds = Array.from(componentDimensions.value.values())
    return calculateVisibleArea(allBounds)
  })

  const mapUIArea = computed(() => {
    const _ = forceRefresh.value
    // Only use nav component dimensions
    const navKeys = ['desktopNav', 'mobileNav', 'mobile-navigation-sheet']
    const navBounds = navKeys
      .map(key => componentDimensions.value.get(key))
      .filter((bounds): bounds is ManualBounds => bounds !== undefined)

    return calculateVisibleArea(navBounds)
  })

  const dialogs = ref<
    {
      id: number
      component: Component
      props: any
      onSubmit: (payload: any) => void
      loading?: boolean
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
        [DialogType.Drawer]: ProgrammaticDrawer,
      }

      if (
        type === DialogType.Component &&
        (options as import('@/types/app.types').ComponentDialogOptions)
          .component
      ) {
        const componentOptions =
          options as import('@/types/app.types').ComponentDialogOptions
        componentOptions.component = markRaw(componentOptions.component)
      }

      if (
        type === DialogType.Drawer &&
        (options as import('@/types/app.types').DrawerOptions).component
      ) {
        const drawerOptions =
          options as import('@/types/app.types').DrawerOptions
        drawerOptions.component = markRaw(drawerOptions.component)
      }

      const newDialog: {
        id: number
        component: Component
        props: any
        onSubmit: (payload: any) => void
        loading?: boolean
      } = {
        id,
        component: markRaw(dialogTypesMap[type]),
        props: options,
        onSubmit: async (payload: any) => {
          // If payload is falsy, it's a cancel action.
          if (!payload) {
            resolve(false)
            removeDialog(id)
            return
          }

          // If there's an onContinue handler, execute it.
          if (options.onContinue) {
            const dialog = dialogs.value.find(d => d.id === id)
            if (dialog) {
              dialog.loading = true
            }

            try {
              const result = await options.onContinue(payload)
              resolve(result)
            } catch (e) {
              console.error('Dialog submission failed', e)
              resolve(false)
            } finally {
              removeDialog(id)
            }
          } else {
            // Otherwise, just resolve with the payload.
            resolve(payload)
            removeDialog(id)
          }
        },
        loading: false,
      }

      dialogs.value.push(newDialog)
    })
  }

  function removeDialog(id: number) {
    const index = dialogs.value.findIndex(dialog => dialog.id === id)
    if (index !== -1) {
      dialogs.value.splice(index, 1)
    }
  }

  // Unit system preference (metric vs imperial)
  const unitSystem = useStorage<UnitSystem>('unit-system', UnitSystem.METRIC)

  return {
    dialogs,
    createDialog,
    removeDialog,
    obstructingComponentsMap,
    trackObstructingComponents: trackObstructingComponent,
    trackObstructingComponentWithKey,
    getObstructingComponent,
    untrackObstructingComponent,
    visibleMapArea,
    mapUIArea,
    refreshObstructingComponents,
    componentDimensions,
    debugObstructingComponents,
    updateManualBounds,
    clearManualBounds,
    unitSystem,
  }
})
