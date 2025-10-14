import {
  onMounted,
  onUnmounted,
  getCurrentInstance,
  Ref,
  watch,
  ref,
} from 'vue'
import { useAppStore, ManualBounds } from '@/stores/app.store'
import { useElementBounding, useMutationObserver } from '@vueuse/core'

interface ObstructingComponent {
  element: Ref<HTMLElement | null>
  bounds: ReturnType<typeof useElementBounding>
}

// Keep track of watched components and their bounds
const watchedComponents: ObstructingComponent[] = []

/**
 * Track main view components that obstruct the map canvas,
 * then derive coordinates for the visible map area.
 * Now uses reactive element tracking to update automatically when components move.
 *
 * @param elementRef Optional ref to an element to track instead of the current component
 * @param key Optional unique key to identify this component for later reference
 * @param manualBounds Optional reactive ref containing manual bounds to use instead of automatic tracking
 * @param enabled Optional reactive ref to enable/disable tracking dynamically
 */
export function useObstructingComponent(
  elementRef?: Ref<HTMLElement | null>,
  key?: string,
  manualBounds?: Ref<ManualBounds | null>,
  enabled?: Ref<boolean>,
) {
  const appStore = useAppStore()
  const instance = getCurrentInstance()
  let componentElement: Ref<HTMLElement | null> = elementRef || ref(null)
  let trackingId: string | undefined
  let isCurrentlyTracked = false

  const trackComponent = () => {
    if (!instance?.proxy || isCurrentlyTracked) return

    if (key) {
      appStore.trackObstructingComponentWithKey(key, instance.proxy)
      trackingId = key
    } else {
      trackingId = appStore.trackObstructingComponents(instance.proxy)
    }
    isCurrentlyTracked = true
  }

  const untrackComponent = () => {
    if (!instance?.proxy || !isCurrentlyTracked) return

    appStore.untrackObstructingComponent(instance.proxy)
    if (trackingId && manualBounds) {
      appStore.clearManualBounds(trackingId)
    }
    isCurrentlyTracked = false
  }

  onMounted(() => {
    if (instance?.proxy) {
      // If no custom element provided, use the component's root element
      if (!elementRef && instance.proxy.$el) {
        componentElement.value = instance.proxy.$el
      }

      // Set up tracking ID
      trackingId = key || `auto_${Date.now()}_${Math.random()}`

      // Watch enabled state if provided
      if (enabled) {
        watch(
          enabled,
          (isEnabled) => {
            if (isEnabled) {
              trackComponent()
            } else {
              untrackComponent()
            }
          },
          { immediate: true },
        )
      } else {
        // Track immediately if no enabled ref provided
        trackComponent()
      }

      // If manual bounds are provided, watch them and update the store
      if (manualBounds) {
        watch(
          manualBounds,
          (bounds) => {
            if (bounds && trackingId && isCurrentlyTracked) {
              appStore.updateManualBounds(trackingId, bounds)
            }
          },
          { immediate: true, deep: true },
        )
      }
      // Otherwise, use automatic bounds tracking
      else {
        // Only set up automatic tracking if we have an element
        if (!componentElement.value) return

        const bounds = useElementBounding(componentElement)

        const tracker: ObstructingComponent = {
          element: componentElement,
          bounds,
        }
        watchedComponents.push(tracker)

        watch(
          [
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            bounds.top,
            bounds.left,
            bounds.right,
            bounds.bottom,
          ],
          () => {
            // Only trigger refresh if the component is visible and tracked
            if (bounds.width.value > 0 && bounds.height.value > 0 && isCurrentlyTracked) {
              appStore.refreshObstructingComponents()
            }
          },
          { immediate: true },
        )

        useMutationObserver(
          componentElement,
          () => {
            if (isCurrentlyTracked) {
              appStore.refreshObstructingComponents()
            }
          },
          {
            attributes: true,
            attributeFilter: ['style', 'class'],
            childList: false,
          },
        )
      }
    }
  })

  onUnmounted(() => {
    if (instance?.proxy) {
      if (isCurrentlyTracked) {
        untrackComponent()
      }

      const index = watchedComponents.findIndex(
        c => c.element.value === componentElement.value,
      )
      if (index !== -1) {
        watchedComponents.splice(index, 1)
      }
    }
  })
}
