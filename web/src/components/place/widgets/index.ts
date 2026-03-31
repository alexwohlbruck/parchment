import { defineAsyncComponent } from 'vue'
import { WidgetType } from '@/types/place.types'

export const widgetComponents: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  [WidgetType.TRANSIT]: defineAsyncComponent(
    () => import('./TransitWidget.vue'),
  ),
  [WidgetType.RELATED_PLACES]: defineAsyncComponent(
    () => import('./RelatedPlacesWidget.vue'),
  ),
  [WidgetType.OSM_TAGS]: defineAsyncComponent(
    () => import('./OsmTagsWidget.vue'),
  ),
}
