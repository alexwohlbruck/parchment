<script setup lang="ts">
import { computed, inject, ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useLayersStore } from '@/stores/layers.store'
import { useResponsive } from '@/lib/utils'
import { Card } from '@/components/ui/card'

import { ItemIcon } from '@/components/ui/item-icon'
import { AppRoute } from '@/router'
import type { ThemeColor } from '@/lib/utils'
import { capitalize } from '@/filters/text.filters'
import Palette from '@/components/palette/Palette.vue'
import { appEventBus } from '@/lib/eventBus'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { getPlaceRoute } from '@/lib/place.utils'

dayjs.extend(relativeTime)

const router = useRouter()
const { t } = useI18n()
const bookmarksStore = useBookmarksStore()
const collectionsStore = useCollectionsStore()
const layersStore = useLayersStore()
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
})

onUnmounted(() => {
  appEventBus.off('palette:focus', handlePaletteFocus)
})

const pinnedBookmarks = computed(() => {
  return bookmarksStore.bookmarks.filter(b => b.presetType)
})

const recentBookmarks = computed(() => {
  return [...bookmarksStore.bookmarks]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 5)
})

const libraryTabs = computed(() => [
  {
    id: 'collections',
    icon: 'FolderOpen',
    color: 'blue' as ThemeColor,
    route: AppRoute.LIBRARY_COLLECTIONS,
    label: capitalize(t('library.entities.collections.title.plural')),
    count: collectionsStore.collections.length || undefined,
  },
  {
    id: 'routes',
    icon: 'Route',
    color: 'green' as ThemeColor,
    route: AppRoute.LIBRARY_ROUTES,
    label: capitalize(t('library.entities.routes.title.plural')),
  },
  {
    id: 'layers',
    icon: 'Layers3',
    color: 'orange' as ThemeColor,
    route: AppRoute.LIBRARY_LAYERS,
    label: capitalize(t('library.entities.layers.title.plural')),
    count: layersStore.userLayers.length || undefined,
  },
  {
    id: 'maps',
    icon: 'Map',
    color: 'violet' as ThemeColor,
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

function navigateToBookmark(bookmark: typeof recentBookmarks.value[number]) {
  bookmarksStore.navigateToBookmark(bookmark)
  const ids = bookmark.externalIds as Record<string, string>
  const [key, value] = ids.osm
    ? ['osm', ids.osm]
    : ids.coords
      ? ['coords', ids.coords]
      : [Object.keys(ids)[0], Object.values(ids)[0]]
  if (!key || !value) return
  const route = getPlaceRoute(`${key}/${value}`)
  if (route) {
    minimizeSheet()
    router.push(route)
  }
}

function formatTimeAgo(dateStr: string) {
  return dayjs(dateStr).fromNow()
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
      <!-- Pinned bookmarks -->
      <div v-if="pinnedBookmarks.length > 0">
        <h3 class="font-display text-lg mb-1.5 px-1 block">{{ t('general.pinned') }}</h3>
        <div class="flex gap-2 overflow-x-auto scrollbar-hidden -mx-1 px-1">
          <Card
            v-for="bookmark in pinnedBookmarks"
            :key="bookmark.id"
            class="shrink-0 w-44 p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateToBookmark(bookmark)"
          >
            <ItemIcon
              :icon="bookmark.icon"
              :icon-pack="bookmark.iconPack ?? 'lucide'"
              :color="(bookmark.iconColor as ThemeColor) || 'blue'"
              size="sm"
              variant="ghost"
            />
            <div class="flex flex-col min-w-0">
              <span class="font-medium text-sm truncate">{{ bookmark.name }}</span>
              <span v-if="bookmark.address" class="text-xs text-muted-foreground truncate">{{ bookmark.address }}</span>
            </div>
          </Card>
        </div>
      </div>

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
      </div>

      <!-- Navigation Section (mobile only) -->
      <div v-if="isMobileScreen">
        <h3 class="font-display text-lg mb-1.5 px-1 block">{{ t('navigation.title') }}</h3>
        <div class="grid grid-cols-2 gap-2">
          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateTo('/directions')"
          >
            <ItemIcon icon="Navigation" color="green" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('directions.title') }}</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateTo('/friends')"
          >
            <ItemIcon icon="UsersRound" color="violet" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('friends.title') }}</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateTo('/timeline')"
          >
            <ItemIcon icon="History" color="orange" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('timeline.title') }}</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateTo('/settings')"
          >
            <ItemIcon icon="Settings" color="neutral" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('settings.title') }}</span>
          </Card>
        </div>
      </div>

      <!-- Recent Places -->
      <div v-if="recentBookmarks.length > 0">
        <h3 class="font-display text-lg mb-1.5 px-1">{{ t('general.recents') }}</h3>
        <div class="space-y-2">
          <Card
            v-for="bookmark in recentBookmarks"
            :key="bookmark.id"
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border shadow-none"
            @click="navigateToBookmark(bookmark)"
          >
            <ItemIcon
              :icon="bookmark.icon"
              :icon-pack="bookmark.iconPack ?? 'lucide'"
              :color="(bookmark.iconColor as ThemeColor) || 'blue'"
              size="sm"
              variant="ghost"
            />
            <div class="grow min-w-0">
              <div class="font-medium text-sm truncate">{{ bookmark.name }}</div>
              <div class="text-xs text-muted-foreground truncate">
                <template v-if="bookmark.presetType">{{ capitalize(bookmark.presetType) }}</template>
                <template v-else-if="bookmark.address">{{ bookmark.address }}</template>
                <template v-if="bookmark.createdAt">
                  <span v-if="bookmark.presetType || bookmark.address"> · </span>
                  {{ formatTimeAgo(bookmark.createdAt) }}
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
