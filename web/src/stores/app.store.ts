import { DialogOptions, DialogType } from '@/types/app.types'
import { defineStore } from 'pinia'
import { Component, computed, ref, watch } from 'vue'
import { useWindowSize } from '@vueuse/core'

import ComponentDialog from '@/components/dialogs/ComponentDialog.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import PromptDialog from '@/components/dialogs/PromptDialog.vue'
import AutoformDialog from '@/components/dialogs/AutoformDialog.vue'

export const useAppStore = defineStore('app', () => {
  const obstructingComponentsMap = ref<Map<string, Component>>(new Map())
  const { width: windowWidth, height: windowHeight } = useWindowSize()
  const forceRefresh = ref(0)
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
      }
    }
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
      try {
        const el = (component as unknown as { $el?: HTMLElement }).$el

        if (!el) continue

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

  // Helper function to calculate visible area given a list of components
  function calculateVisibleArea(components: Component[]) {
    const viewportWidth = windowWidth.value
    const viewportHeight = windowHeight.value

    let availableArea = {
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight,
    }

    if (components.length === 0) {
      return availableArea
    }

    const obstacles = components
      .map(component => {
        try {
          const el = (component as unknown as { $el?: HTMLElement }).$el

          if (!el) return null

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
    return calculateVisibleArea(
      Array.from(obstructingComponentsMap.value.values()),
    )
  })

  const mapUIArea = computed(() => {
    const _ = forceRefresh.value
    const navKeys = ['desktopNav', 'mobileNav']
    const navComponents = navKeys
      .map(key => obstructingComponentsMap.value.get(key))
      .filter((component): component is Component => component !== undefined)

    return calculateVisibleArea(navComponents)
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
    obstructingComponentsMap,
    trackObstructingComponents: trackObstructingComponent,
    trackObstructingComponentWithKey,
    getObstructingComponent,
    untrackObstructingComponent,
    visibleMapArea,
    mapUIArea,
    refreshObstructingComponents,
    componentDimensions,
  }
})
