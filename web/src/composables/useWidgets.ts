import { ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { Place, WidgetDescriptor, WidgetResponse, WidgetType } from '@/types/place.types'

export interface WidgetState {
  loading: boolean
  data: WidgetResponse | null
  error: string | null
}

export function useWidgets(place: Ref<Partial<Place> | null>) {
  const widgetStates = ref<Map<WidgetType, WidgetState>>(new Map())

  watch(
    () => place.value?.widgets,
    async (widgets) => {
      // Clear stale widget states
      widgetStates.value = new Map()

      if (!widgets?.length) return

      // Initialize loading states for all widgets immediately
      for (const descriptor of widgets) {
        widgetStates.value.set(descriptor.type, {
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
    try {
      const response = await api.get<WidgetResponse>(
        `/places/widgets/${descriptor.type}`,
        { params: descriptor.params },
      )

      widgetStates.value.set(descriptor.type, {
        loading: false,
        data: response.data,
        error: null,
      })
    } catch (e) {
      widgetStates.value.set(descriptor.type, {
        loading: false,
        data: null,
        error: e instanceof Error ? e.message : 'Failed to load widget',
      })
    }
    // Trigger reactivity
    widgetStates.value = new Map(widgetStates.value)
  }

  function getWidgetState(type: WidgetType): WidgetState | undefined {
    return widgetStates.value.get(type)
  }

  return { widgetStates, getWidgetState }
}
