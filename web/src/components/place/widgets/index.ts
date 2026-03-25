import { defineAsyncComponent } from 'vue'
import { WidgetType } from '@/types/place.types'

export const widgetComponents: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  [WidgetType.TRANSIT]: defineAsyncComponent(
    () => import('./TransitWidget.vue'),
  ),
}
