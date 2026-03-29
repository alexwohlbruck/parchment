import { shallowRef, triggerRef, watch, onUnmounted, type Ref } from 'vue'
import axios from 'axios'
import { api } from '@/lib/api'
import type { Place, WidgetDescriptor, WidgetResponse } from '@/types/place.types'
import { WidgetDataType } from '@/types/place.types'

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
  // shallowRef: Map mutations (.set/.delete) don't trigger Vue reactivity on their own.
  // We call triggerRef(widgetStates) after every mutation instead of replacing the Map.
  const widgetStates = shallowRef<Map<string, WidgetState>>(new Map())

  // Each time the place changes, the previous widgets' requests are aborted.
  // onUnmounted also aborts anything still in flight when the component tears down.
  let controller = new AbortController()
  onUnmounted(() => controller.abort())

  watch(
    () => place.value?.widgets,
    async (widgets) => {
      // Abort any in-flight widget requests from the previous place
      controller.abort()
      controller = new AbortController()
      const signal = controller.signal

      // Clear stale widget states
      widgetStates.value = new Map()

      if (!widgets?.length) return

      // Resolve static widgets immediately; initialise async widgets as loading
      for (const descriptor of widgets) {
        const key = descriptorKey(descriptor)

        if (descriptor.dataType === WidgetDataType.STATIC) {
          // Data is embedded in the descriptor — parse and set immediately (no skeleton)
          const raw = (descriptor.params as Record<string, string>).staticData
          const data: WidgetResponse | null = raw ? JSON.parse(raw) : null
          widgetStates.value.set(key, { loading: false, data, error: null })
        } else {
          // ASYNC widget — show skeleton while fetching
          widgetStates.value.set(key, { loading: true, data: null, error: null })
        }
      }
      triggerRef(widgetStates)

      // Fetch all async widgets in parallel
      const asyncWidgets = widgets.filter(d => d.dataType === WidgetDataType.ASYNC)
      await Promise.allSettled(asyncWidgets.map(desc => fetchWidget(desc, signal)))
    },
    { immediate: true },
  )

  async function fetchWidget(descriptor: WidgetDescriptor, signal: AbortSignal) {
    const key = descriptorKey(descriptor)
    try {
      const response = await api.get<WidgetResponse>(
        `/places/widgets/${descriptor.type}`,
        { params: descriptor.params, signal },
      )

      widgetStates.value.set(key, {
        loading: false,
        data: response.data,
        error: null,
      })
    } catch (e) {
      if (axios.isCancel(e)) return // silently discard — component navigated away
      widgetStates.value.set(key, {
        loading: false,
        data: null,
        error: e instanceof Error ? e.message : 'Failed to load widget',
      })
    }
    triggerRef(widgetStates)
  }

  function getWidgetState(key: string): WidgetState | undefined {
    return widgetStates.value.get(key)
  }

  return { widgetStates, getWidgetState, descriptorKey }
}
