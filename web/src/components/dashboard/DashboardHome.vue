<script setup lang="ts">
import { computed, inject, ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useDark } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useLayersStore } from '@/stores/layers.store'
import { useRecentsStore } from '@/stores/recents.store'
import { useResponsive } from '@/lib/utils'
import { Card } from '@/components/ui/card'

import { ItemIcon } from '@/components/ui/item-icon'
import { AppRoute } from '@/router'
import type { ThemeColor } from '@/lib/utils'
import type { RecentPlaceEntry } from '@/lib/recents'
import { capitalize } from '@/filters/text.filters'
import Palette from '@/components/palette/Palette.vue'
import PresetPlacesRow from '@/components/library/PresetPlacesRow.vue'
import { appEventBus } from '@/lib/eventBus'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { getPlaceRoute } from '@/lib/place.utils'
import { getCategoryColor } from '@/lib/place-colors'

dayjs.extend(relativeTime)

const router = useRouter()
const { t } = useI18n()
const isDark = useDark()
const collectionsStore = useCollectionsStore()
const layersStore = useLayersStore()
const recentsStore = useRecentsStore()
const { places: recentPlaces } = storeToRefs(recentsStore)
const { isMobileScreen, isDesktopScreen } = useResponsive()

const minimizeSheet = inject<() => void>('minimizeMobileSheet', () => {})
const expandSheet = inject<() => void>('expandMobileSheet', () => {})
const emit = defineEmits<{ 'update:palette-focused': [value: boolean] }>()

const paletteRef = ref<InstanceType<typeof Palette> | null>(null)
const paletteFocused = ref(false)

function onPaletteInputFocused() {
  paletteFocused.value = true
  emit('update:palette-focused', true)
  expandSheet()
}

function onPaletteClosed() {
  paletteFocused.value = false
  emit('update:palette-focused', false)
}

const handlePaletteFocus = () => {
  paletteRef.value?.focusInput()
}

onMounted(() => {
  appEventBus.on('palette:focus', handlePaletteFocus)
  recentsStore.ensurePlacesHydrated()
})

onUnmounted(() => {
  appEventBus.off('palette:focus', handlePaletteFocus)
})

const libraryTabs = computed(() => [
  {
    id: 'collections',
    icon: 'FolderOpen',
    color: 'cobalt' as ThemeColor,
    route: AppRoute.LIBRARY_COLLECTIONS,
    label: capitalize(t('library.entities.collections.title.plural')),
    count: collectionsStore.collections.length || undefined,
  },
  {
    id: 'routes',
    icon: 'Route',
    color: 'forest' as ThemeColor,
    route: AppRoute.LIBRARY_ROUTES,
    label: capitalize(t('library.entities.routes.title.plural')),
  },
  {
    id: 'layers',
    icon: 'Layers3',
    color: 'coral' as ThemeColor,
    route: AppRoute.LIBRARY_LAYERS,
    label: capitalize(t('library.entities.layers.title.plural')),
    count: layersStore.userLayers.length || undefined,
  },
  {
    id: 'maps',
    icon: 'Map',
    color: 'iris' as ThemeColor,
    route: AppRoute.LIBRARY_MAPS,
    label: capitalize(t('library.entities.maps.title.plural')),
  },
])

function navigateTo(path: string) {
  minimizeSheet()
  router.push(path)
}

function navigateToRoute(routeName: AppRoute) {
  minimizeSheet()
  router.push({ name: routeName })
}

function navigateToRecentPlace(place: RecentPlaceEntry) {
  const route = getPlaceRoute(place.id)
  if (route) {
    minimizeSheet()
    router.push(route)
  }
}

function placeColor(place: RecentPlaceEntry): string {
  return getCategoryColor(place.category ?? 'default', isDark.value)
}

function formatTimeAgo(date: string | number) {
  return dayjs(date).fromNow()
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="space-y-4 flex-1">
      <!-- Inline command palette -->
      <div class="relative rounded-xl bg-card">
        <Palette
          ref="paletteRef"
          search-on-open
          @input-focused="onPaletteInputFocused"
          @update:open="val => { if (!val) onPaletteClosed() }"
        />
      </div>

      <div v-show="!paletteFocused" class="space-y-6">
      <!-- Library Section -->
      <div>
        <h3 class="font-display text-lg mb-1.5 px-1 block">{{ t('library.title') }}</h3>

        <div class="grid grid-cols-2 gap-2">
          <Card
            v-for="tab in libraryTabs"
            :key="tab.id"
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateToRoute(tab.route)"
          >
            <ItemIcon
              :icon="tab.icon"
              :color="tab.color"
              size="sm"
              variant="ghost"
            />
            <div class="flex flex-col min-w-0">
              <span class="font-medium text-sm">{{ tab.label }}</span>
              <span v-if="tab.count" class="text-xs text-muted-foreground">{{ tab.count }}</span>
            </div>
          </Card>
        </div>

        <!-- Home / Work / School quick places -->
        <PresetPlacesRow class="mt-2" />
      </div>

      <!-- Navigation Section (mobile only) -->
      <div v-if="isMobileScreen">
        <h3 class="font-display text-lg mb-1.5 px-1 block">{{ t('navigation.title') }}</h3>
        <div class="grid grid-cols-2 gap-2">
          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateTo('/directions')"
          >
            <ItemIcon icon="Navigation" color="forest" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('directions.title') }}</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateTo('/lookout')"
          >
            <ItemIcon icon="Telescope" color="violet" size="sm" variant="ghost" />
            <span class="font-medium text-sm">Lookout</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateTo('/timeline')"
          >
            <ItemIcon icon="History" color="amber" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('timeline.title') }}</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateTo('/settings')"
          >
            <ItemIcon icon="Settings" color="parchment" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('settings.title') }}</span>
          </Card>
        </div>
      </div>

      <!-- Recently viewed places -->
      <div v-if="recentPlaces.length > 0">
        <h3 class="font-display text-lg mb-1.5 px-1">{{ t('general.recents') }}</h3>
        <div class="space-y-2">
          <Card
            v-for="place in recentPlaces.slice(0, 5)"
            :key="place.id"
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateToRecentPlace(place)"
          >
            <ItemIcon
              :icon="place.icon || 'MapPin'"
              :icon-pack="place.iconPack ?? 'lucide'"
              :custom-color="placeColor(place)"
              size="sm"
              variant="ghost"
            />
            <div class="grow min-w-0">
              <div class="font-medium text-sm truncate">{{ place.title }}</div>
              <div class="text-xs text-muted-foreground truncate">
                <template v-if="place.subtitle">{{ place.subtitle }}</template>
                <template v-if="place.at">
                  <span v-if="place.subtitle"> · </span>
                  {{ formatTimeAgo(place.at) }}
                </template>
              </div>
            </div>
          </Card>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
