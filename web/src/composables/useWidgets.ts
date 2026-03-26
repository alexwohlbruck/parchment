import { ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { Place, WidgetDescriptor, WidgetResponse } from '@/types/place.types'

export interface WidgetState {
  loading: boolean
  data: WidgetResponse | null
  error: string | null
}

/**
 * Unique key for a widget descriptor.
 * Uses type + strategy param (if present) so multiple related_places widgets
 * (children / parent / admin) can coexist in the same map.
 */
export function descriptorKey(desc: WidgetDescriptor): string {
  const strategy = (desc.params as Record<string, string>)?.strategy
  return strategy ? `${desc.type}:${strategy}` : desc.type
}

export function useWidgets(place: Ref<Partial<Place> | null>) {
  const widgetStates = ref<Map<string, WidgetState>>(new Map())

  watch(
    () => place.value?.widgets,
    async (widgets) => {
      // Clear stale widget states
      widgetStates.value = new Map()

      if (!widgets?.length) return

      // Initialize loading states for all widgets immediately
      for (const descriptor of widgets) {
        widgetStates.value.set(descriptorKey(descriptor), {
          loading: true,
          data: null,
          error: null,
        })
      }
      // Trigger reactivity
      widgetStates.value = new Map(widgetStates.value)

      // Fetch all widgets in parallel
      await Promise.allSettled(widgets.map((desc) => fetchWidget(desc)))
    },
    { immediate: true },
  )

  async function fetchWidget(descriptor: WidgetDescriptor) {
    const key = descriptorKey(descriptor)
    try {
      const response = await api.get<WidgetResponse>(
        `/places/widgets/${descriptor.type}`,
        { params: descriptor.params },
      )

      widgetStates.value.set(key, {
        loading: false,
        data: response.data,
        error: null,
      })
    } catch (e) {
      widgetStates.value.set(key, {
        loading: false,
        data: null,
        error: e instanceof Error ? e.message : 'Failed to load widget',
      })
    }
    // Trigger reactivity
    widgetStates.value = new Map(widgetStates.value)
  }

  function getWidgetState(key: string): WidgetState | undefined {
    return widgetStates.value.get(key)
  }

  return { widgetStates, getWidgetState, descriptorKey }
}
