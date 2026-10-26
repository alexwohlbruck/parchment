import { inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { useGuidanceCamera } from '@/composables/guidance/useGuidanceCamera'
import type { useGuidanceRouteLine } from '@/composables/guidance/useGuidanceRouteLine'
import type { useAlternativeRoutes } from '@/composables/guidance/useAlternativeRoutes'
import type { useBetterItinerary } from '@/composables/guidance/useBetterItinerary'
import type { useDockWatch } from '@/composables/guidance/useDockWatch'
import type { FreeMode } from '@/lib/guidance/free-roam'

export type GuidancePanelKind = 'menu' | 'steps' | 'search' | 'routes' | 'destination'

export interface GuidanceContext {
  camera: ReturnType<typeof useGuidanceCamera>
  routeLine: ReturnType<typeof useGuidanceRouteLine>
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
  /** How to roam on once there is nothing left to navigate, if the mode allows it. */
  keepGoing: ComputedRef<FreeMode | null>
}

export const GUIDANCE_CONTEXT: InjectionKey<GuidanceContext> = Symbol('guidance')

export function useGuidanceContext(): GuidanceContext {
  const context = inject(GUIDANCE_CONTEXT)
  if (!context) throw new Error('useGuidanceContext() needs the guidance view as an ancestor')
  return context
}
