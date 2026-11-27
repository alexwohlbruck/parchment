import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { useLayersStore } from '@/stores/layers.store'
import { useLayerAppearanceStore } from '@/stores/layer-appearance.store'
import { useMapTimeStore } from '@/stores/map-time.store'
import type { MapStrategy } from '@/services/map/providers/map.strategy'
import { usePortolanTransitService } from '@/services/layers/features/portolan/portolan-transit.service'
import {
  CLASS_GROUP_ROW_ID_PREFIX,
  TRANSIT_CLASS_GROUPS,
  TRANSIT_GROUP_ID,
  type TransitClassGroup,
  classVisibilityFor,
} from '@/services/layers/features/portolan/portolan-ui'

/**
 * UI state for the portolan transit feature: the Transit group master
 * switch drives init/teardown, the four class toggles drive
 * setClassVisibility, and the shared map time drives setServiceTime.
 *
 * Class toggle state persists in the layers store's localStorage
 * visibility override map (same map every layer row rides), keyed by
 * synthetic `portolan:class:*` ids.
 */
export const usePortolanTransitStore = defineStore('portolan-transit', () => {
  const layersStore = useLayersStore()
  const appearanceStore = useLayerAppearanceStore()
  const mapTimeStore = useMapTimeStore()
  const portolanService = usePortolanTransitService()

  let mapStrategy: MapStrategy | undefined

  // ── enablement ───────────────────────────────────────────────────────
  // The group switch is the product toggle; the dev flag is a session
  // constant OR'd in (documented in portolan-transit.service).
  const devFlag = (() => {
    try {
      return localStorage.getItem('parchment.portolan-transit') === '1'
    } catch {
      return false
    }
  })()

  const groupVisible = computed(() =>
    layersStore.allLayerGroups.some(g => g.id === TRANSIT_GROUP_ID && g.visible),
  )
  const active = computed(() => devFlag || groupVisible.value)

  // ── class toggles (Rail / Bus / Ferry / Other) ───────────────────────
  const classGroups = computed<Record<TransitClassGroup, boolean>>(() => {
    const out = {} as Record<TransitClassGroup, boolean>
    for (const g of TRANSIT_CLASS_GROUPS) {
      out[g] = layersStore.getLayerVisibilityOverride(CLASS_GROUP_ROW_ID_PREFIX + g) ?? true
    }
    return out
  })

  function setClassGroupVisible(group: TransitClassGroup, visible: boolean) {
    layersStore.updateLayerVisibility(CLASS_GROUP_ROW_ID_PREFIX + group, visible)
  }

  /** The time the network is filtered to; none draws every line, whenever it runs. */
  const filterDate = computed(() =>
    appearanceStore.appearanceOf(TRANSIT_GROUP_ID)?.id === 'full-service' ? null : mapTimeStore.time,
  )

  // ── renderer wiring ──────────────────────────────────────────────────

  function applyFilters() {
    portolanService.setServiceTime(filterDate.value)
    portolanService.setClassVisibility(classVisibilityFor(classGroups.value))
  }

  watch(active, on => {
    if (on) {
      portolanService.initializePortolanTransit(mapStrategy)
      applyFilters()
    } else {
      portolanService.teardownPortolanTransit()
    }
    // The basemap's OSM stops stand down while the feed's own stops are drawn,
    // or every station gets two near-duplicate markers a few metres apart.
    mapStrategy?.setBasemapTransitPoisVisible(!on)
  })

  watch(filterDate, d => {
    if (active.value) portolanService.setServiceTime(d)
  })

  watch(classGroups, g => {
    if (active.value) portolanService.setClassVisibility(classVisibilityFor(g))
  })

  /** Called from map.service on every style.load (setStyle drops all
   *  portolan sources/layers; the service re-adds idempotently). */
  function handleStyleLoad(strategy: MapStrategy | undefined) {
    mapStrategy = strategy
    // A style swap rebuilds every layer with its original filter, so this has
    // to be reapplied whether the group is on or off.
    strategy?.setBasemapTransitPoisVisible(!active.value)
    if (!active.value) return
    portolanService.initializePortolanTransit(strategy)
    applyFilters()
  }

  return {
    active,
    groupVisible,
    classGroups,
    setClassGroupVisible,
    handleStyleLoad,
  }
})
