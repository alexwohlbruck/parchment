<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { watchDebounced } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { DownloadIcon } from 'lucide-vue-next'
import DetailPanelLayout from '@/components/sheet/layouts/DetailPanelLayout.vue'
import RegionFrame from '@/components/offline/RegionFrame.vue'
import SheetFooter from '@/components/sheet/SheetFooter.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ItemIcon } from '@/components/ui/item-icon'
import { SectionHeader } from '@/components/ui/section-header'
import { useOfflineLayerOptions } from '@/composables/offline/useOfflineLayerOptions'
import { useConnectivity } from '@/composables/useConnectivity'
import { useOfflineStore } from '@/stores/offline.store'
import { reverseGeocode } from '@/services/geocoding.service'
import { sampleTileBytes, sampleUrl } from '@/services/offline/tile-sample.service'
import { planRegion } from '@/lib/offline/region-plan'
import { boundsWidthKm } from '@/lib/offline/tiles'
import { BASEMAP_OPTION_ID, TERRAIN_OPTION_ID } from '@/lib/offline/layer-options'
import { formatBytes } from '@/lib/offline/format'
import { estimatePackageBytes } from '@/lib/offline/packages'
import { AppRoute } from '@/router'
import type { OfflinePackageKind } from '@/types/offline-package.types'
import type { Bounds, OfflineLayerOption } from '@/types/offline.types'

/** Past this many tiles a download takes too long and too much space. */
const MAX_TILES = 30_000
const NAME_TIMEOUT_MS = 3000
const SAMPLE_DEBOUNCE_MS = 500

const { t, locale } = useI18n()
const router = useRouter()
const offlineStore = useOfflineStore()
const { isOffline } = useConnectivity()
const { options, visibleIds } = useOfflineLayerOptions()

const bounds = shallowRef<Bounds | null>(null)
const selected = ref(new Set<string>())
const saving = ref(false)

// Start from what's on the map now; the user can add or drop layers from there.
let preselected = false
watch(
  options,
  list => {
    if (preselected || !list.length) return
    preselected = true
    selected.value = new Set(list.filter(o => visibleIds.value.has(o.id)).map(o => o.id))
  },
  { immediate: true },
)

const isChosen = (o: OfflineLayerOption) => !!o.required || selected.value.has(o.id)

function toggle(id: string, on: boolean) {
  const next = new Set(selected.value)
  if (on) next.add(id)
  else next.delete(id)
  selected.value = next
}

const chosen = computed(() => options.value.filter(isChosen))

const FEATURES = [
  { id: 'search', icon: 'SearchIcon', packages: ['places'] },
  { id: 'directions', icon: 'RouteIcon', packages: ['streets', 'timetable'] },
] as const satisfies readonly { id: string; icon: string; packages: readonly OfflinePackageKind[] }[]

const features = ref(new Set<string>(FEATURES.map(f => f.id)))

function toggleFeature(id: string, on: boolean) {
  const next = new Set(features.value)
  if (on) next.add(id)
  else next.delete(id)
  features.value = next
}

const packages = computed<OfflinePackageKind[]>(() =>
  FEATURES.filter(f => features.value.has(f.id)).flatMap(f => f.packages),
)

/** Measured bytes of one tile per source, keyed by its template, kept while the map moves. */
const tileBytes = shallowRef(new Map<string, number>())
const plan = computed(() =>
  bounds.value ? planRegion(bounds.value, chosen.value, s => tileBytes.value.get(s.tiles[0])) : null,
)

watchDebounced(
  [bounds, chosen],
  async () => {
    const area = bounds.value
    if (!area || !plan.value) return
    const measured = await Promise.all(
      plan.value.sources.map(async s => [s.tiles[0], await sampleTileBytes(sampleUrl(s, area))] as const),
    )
    const next = new Map(tileBytes.value)
    for (const [template, bytes] of measured) if (bytes !== undefined) next.set(template, bytes)
    tileBytes.value = next
  },
  { debounce: SAMPLE_DEBOUNCE_MS, immediate: true },
)
const tooLarge = computed(() => (plan.value?.total ?? 0) > MAX_TILES)

const summary = computed(() => {
  if (!bounds.value || !plan.value) return ''
  if (tooLarge.value) return t('offlineMaps.new.tooLarge')
  return t('offlineMaps.new.summary', {
    size: formatBytes(plan.value.estimatedBytes + estimatePackageBytes(packages.value, bounds.value), locale.value),
    width: Math.round(boundsWidthKm(bounds.value)),
  })
})

const optionName = (o: OfflineLayerOption) => {
  if (o.id === BASEMAP_OPTION_ID) return t('offlineMaps.layers.basemap')
  if (o.id === TERRAIN_OPTION_ID) return t('offlineMaps.layers.terrain')
  return o.name
}

async function regionName(b: Bounds): Promise<string> {
  const lookup = reverseGeocode({ lat: (b[1] + b[3]) / 2, lng: (b[0] + b[2]) / 2, limit: 1 })
    .then(r => {
      const address = r.results?.[0]?.address?.value
      return address?.locality || address?.neighborhood || address?.region || null
    })
    .catch(() => null)
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), NAME_TIMEOUT_MS))
  return (await Promise.race([lookup, timeout])) ?? t('offlineMaps.new.defaultName')
}

async function save() {
  if (!bounds.value || tooLarge.value) return
  saving.value = true
  const area = bounds.value
  try {
    await offlineStore.createRegion({
      name: await regionName(area),
      bounds: area,
      options: chosen.value,
      packages: packages.value,
    })
    router.replace({ name: AppRoute.OFFLINE_MAPS })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <DetailPanelLayout :title="t('offlineMaps.new.title')">
    <RegionFrame v-model:bounds="bounds" :too-large="tooLarge" />

    <p class="px-1 text-sm text-muted-foreground">{{ t('offlineMaps.new.hint') }}</p>

    <SectionHeader :title="t('offlineMaps.new.layers')" class="mt-5 mb-1.5 px-1" />
    <div class="flex flex-col">
      <label
        v-for="option in options"
        :key="option.id"
        class="flex items-center gap-3 rounded-lg px-1 py-2"
        :class="!option.required && 'cursor-pointer'"
      >
        <ItemIcon :icon="option.icon ?? 'MapIcon'" color="parchment" size="sm" variant="ghost" />
        <span class="flex-1 text-sm">{{ optionName(option) }}</span>
        <Switch
          :model-value="isChosen(option)"
          :disabled="option.required"
          @update:model-value="toggle(option.id, $event)"
        />
      </label>
    </div>

    <SectionHeader :title="t('offlineMaps.new.features')" class="mt-5 mb-1.5 px-1" />
    <div class="flex flex-col">
      <label v-for="feature in FEATURES" :key="feature.id" class="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2">
        <ItemIcon :icon="feature.icon" color="parchment" size="sm" variant="ghost" />
        <span class="flex-1 text-sm">{{ t(`offlineMaps.features.${feature.id}`) }}</span>
        <Switch :model-value="features.has(feature.id)" @update:model-value="toggleFeature(feature.id, $event)" />
      </label>
    </div>

    <SheetFooter
      class="flex flex-col gap-2 px-4 pt-2 pb-3 md:-mx-4 md:-mb-4 bg-background/80 backdrop-blur-xl border-t border-border/50"
    >
      <p class="px-1 text-sm" :class="tooLarge ? 'text-destructive' : 'text-muted-foreground'">
        {{ isOffline ? t('offlineMaps.new.needsConnection') : summary }}
      </p>
      <Button :disabled="!bounds || tooLarge || isOffline || saving" class="gap-2" @click="save">
        <DownloadIcon class="size-4" />
        {{ t('offlineMaps.new.download') }}
      </Button>
    </SheetFooter>
  </DetailPanelLayout>
</template>
