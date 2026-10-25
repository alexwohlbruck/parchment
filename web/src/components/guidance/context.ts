import { inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { useGuidanceCamera } from '@/composables/guidance/useGuidanceCamera'
import type { useAlternativeRoutes } from '@/composables/guidance/useAlternativeRoutes'
import type { useBetterItinerary } from '@/composables/guidance/useBetterItinerary'
import type { useDockWatch } from '@/composables/guidance/useDockWatch'

export type GuidancePanelKind = 'menu' | 'steps' | 'search' | 'routes'

export interface GuidanceContext {
  camera: ReturnType<typeof useGuidanceCamera>
  alternatives: ReturnType<typeof useAlternativeRoutes>
  itinerary: ReturnType<typeof useBetterItinerary>
  docks: ReturnType<typeof useDockWatch>
  metric: ComputedRef<boolean>
  panel: Ref<GuidancePanelKind | null>
  /** Whether closing the open panel returns to the menu rather than to the map. */
  panelReturnsToMenu: ComputedRef<boolean>
  openPanel: (panel: GuidancePanelKind) => void
  /** Steps back to the menu, or with `outright` straight to the map. */
  closePanel: (outright?: boolean) => void
  exit: () => void
}

export const GUIDANCE_CONTEXT: InjectionKey<GuidanceContext> = Symbol('guidance')

export function useGuidanceContext(): GuidanceContext {
  const context = inject(GUIDANCE_CONTEXT)
  if (!context) throw new Error('useGuidanceContext() needs the guidance view as an ancestor')
  return context
}
