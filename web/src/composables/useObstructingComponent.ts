import {
  onMounted,
  onUnmounted,
  getCurrentInstance,
  Ref,
  watch,
  ref,
} from 'vue'
import { useAppStore } from '@/stores/app.store'
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
 */
export function useObstructingComponent(
  elementRef?: Ref<HTMLElement | null>,
  key?: string,
) {
  const appStore = useAppStore()
  const instance = getCurrentInstance()
  let componentElement: Ref<HTMLElement | null> = elementRef || ref(null)
  let trackingId: string | undefined

  onMounted(() => {
    if (instance?.proxy) {
      // If no custom element provided, use the component's root element
      if (!elementRef && instance.proxy.$el) {
        componentElement.value = instance.proxy.$el
      }

      // Helper to extract HTMLElement from either a direct element or component instance
      const getHTMLElement = (target: any): HTMLElement | null => {
        if (!target) return null
        if (target instanceof HTMLElement) return target
        // If it's a component instance with $el, use that
        if (target.$el instanceof HTMLElement) return target.$el
        return null
      }

      // Wait for next tick to ensure element refs are populated (important for portals)
      const setupTracking = () => {
        // Get the actual HTMLElement from the elementRef or component
        const actualElement = getHTMLElement(componentElement.value)
        
        // Track the element or component
        // Prefer the actual HTMLElement if available, otherwise use the component proxy
        const trackingTarget = actualElement || instance.proxy
        
        if (key) {
          appStore.trackObstructingComponentWithKey(key, trackingTarget!)
          trackingId = key
        } else {
          trackingId = appStore.trackObstructingComponents(trackingTarget!)
        }

        // Only set up watching if we have a valid HTMLElement
        if (actualElement) {
          const elementRefForBounds = ref(actualElement)
          const bounds = useElementBounding(elementRefForBounds)

          const tracker: ObstructingComponent = {
            element: elementRefForBounds,
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
              // Only trigger refresh if the component is visible
              if (bounds.width.value > 0 && bounds.height.value > 0) {
                appStore.refreshObstructingComponents()
              }
            },
            { immediate: true },
          )

          useMutationObserver(
            elementRefForBounds,
            () => {
              appStore.refreshObstructingComponents()
            },
            {
              attributes: true,
              attributeFilter: ['style', 'class'],
              childList: false,
            },
          )
        }
      }

      // For custom element refs (like portals), wait for the ref to be populated
      if (elementRef) {
        // Watch the ref until it's populated with a valid element
        const stopWatch = watch(
          componentElement,
          (el) => {
            const actualElement = getHTMLElement(el)
            if (actualElement) {
              setupTracking()
              stopWatch()
            }
          },
          { immediate: true }
        )
      } else {
        setupTracking()
      }
    }
  })

  onUnmounted(() => {
    if (trackingId) {
      appStore.untrackObstructingComponent(trackingId)

      const index = watchedComponents.findIndex(
        c => c.element.value === componentElement.value,
      )
      if (index !== -1) {
        watchedComponents.splice(index, 1)
      }
    }
  })
}
