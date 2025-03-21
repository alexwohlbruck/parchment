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
 */
export function useObstructingComponent(elementRef?: Ref<HTMLElement | null>) {
  const appStore = useAppStore()
  const instance = getCurrentInstance()
  let componentElement: Ref<HTMLElement | null> = elementRef || ref(null)

  onMounted(() => {
    if (instance?.proxy) {
      // If no custom element provided, use the component's root element
      if (!elementRef && instance.proxy.$el) {
        componentElement.value = instance.proxy.$el
      }

      appStore.trackObstructingComponents(instance.proxy)

      if (componentElement.value) {
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
            // Only trigger refresh if the component is visible
            if (bounds.width.value > 0 && bounds.height.value > 0) {
              appStore.refreshObstructingComponents()
            }
          },
          { immediate: true },
        )

        if (componentElement.value) {
          useMutationObserver(
            componentElement,
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
    }
  })

  onUnmounted(() => {
    if (instance?.proxy) {
      appStore.untrackObstructingComponent(instance.proxy)

      const index = watchedComponents.findIndex(
        c => c.element.value === componentElement.value,
      )
      if (index !== -1) {
        watchedComponents.splice(index, 1)
      }
    }
  })
}
