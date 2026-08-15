<script setup lang="ts">
import {
  computed,
  inject,
  ref,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
} from 'vue'
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
import { recentPlaceIdentity, recentSearchIdentity } from '@/lib/recents'
import { capitalize } from '@/filters/text.filters'
import Palette from '@/components/palette/Palette.vue'
import PresetPlacesRow from '@/components/library/PresetPlacesRow.vue'
import { appEventBus } from '@/lib/eventBus'
import { findScrollAncestor } from '@/lib/scroll'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { PlaceCard } from '@/components/place/card'
import { SectionHeader } from '@/components/ui/section-header'
import {
  recentPlaceToDisplay,
  recentSearchToDisplay,
  type PlaceDisplay,
} from '@/lib/place-display'

dayjs.extend(relativeTime)

const router = useRouter()
const { t } = useI18n()
const isDark = useDark()
const collectionsStore = useCollectionsStore()
const layersStore = useLayersStore()
const recentsStore = useRecentsStore()
const { places: recentPlaces, searches: recentSearches } = storeToRefs(recentsStore)
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
  recentsStore.ensureSearchesHydrated()
})

onUnmounted(() => {
  appEventBus.off('palette:focus', handlePaletteFocus)
})

/**
 * Recents infinite scroll. The E2EE blob is fully decrypted in memory, so
 * "loading more" is just revealing more of the array — pages exist only to
 * keep the initial dashboard render short.
 *
 * The scroll surface belongs to the host sheet, and this listens to it
 * directly — deliberately, because the two tidier-looking options both fail
 * here. A sentinel at the end of the list only enters view on the sheet's very
 * last pixel of scroll, and not at all once the list has trailing padding.
 * `useInfiniteScroll` never binds to a scroll element that resolves after
 * mount, so it sat silent through every scroll in Firefox.
 */
const RECENTS_PAGE_SIZE = 10
const RECENTS_LOAD_MARGIN = 200
const visibleRecentsCount = ref(RECENTS_PAGE_SIZE)

/** A row in the recents list — either kind, already adapted for rendering. */
interface RecentItem {
  key: string
  display: PlaceDisplay
  subtitle: string
}

/**
 * Searches and viewed places in one list, newest first — the same merge the
 * palette's Recents section does. The two surfaces read the same history, so
 * showing places here and both kinds there made a category or query you just
 * ran look like it was never recorded.
 */
const recentItems = computed<RecentItem[]>(() =>
  [
    ...recentPlaces.value.map(place => ({
      key: recentPlaceIdentity(place),
      at: place.at,
      display: recentPlaceToDisplay(place, { isDark: isDark.value }),
      subtitle: recentSubtitle(place.subtitle, place.at),
    })),
    ...recentSearches.value.map(search => ({
      key: recentSearchIdentity(search),
      at: search.at,
      display: recentSearchToDisplay(search, { isDark: isDark.value }),
      subtitle: recentSubtitle(null, search.at),
    })),
  ].sort((a, b) => b.at - a.at),
)

const visibleRecents = computed(() =>
  recentItems.value.slice(0, visibleRecentsCount.value),
)
const hasMoreRecents = computed(
  () => visibleRecentsCount.value < recentItems.value.length,
)

const rootEl = ref<HTMLElement | null>(null)
let scrollEl: HTMLElement | null = null

/**
 * Reveal the next page once the sheet is scrolled within `RECENTS_LOAD_MARGIN`
 * of its end, then re-check: a page that doesn't make the sheet scrollable
 * would otherwise leave no way to ask for the one after it.
 *
 * Paging a hidden list would page all of it — the palette covers this section,
 * and a covered sheet has nothing to scroll, which reads as "at the end".
 */
function revealMore(margin: number) {
  if (!scrollEl || paletteFocused.value || !hasMoreRecents.value) return
  const remaining =
    scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop
  if (remaining > margin) return
  visibleRecentsCount.value += RECENTS_PAGE_SIZE
  nextTick(() => revealMore(margin))
}

const onSheetScroll = () => revealMore(RECENTS_LOAD_MARGIN)
/** Margin 0, so a sheet the user can already scroll keeps its first page. */
const fillUnscrollableSheet = () => nextTick(() => revealMore(0))

onMounted(() => {
  scrollEl = findScrollAncestor(rootEl.value)
  scrollEl?.addEventListener('scroll', onSheetScroll, { passive: true })
  fillUnscrollableSheet()
})

onUnmounted(() => scrollEl?.removeEventListener('scroll', onSheetScroll))

// Recents decrypt asynchronously, so the list usually lands after mount — and
// each kind lands on its own, so this watches the merged result.
watch(recentItems, fillUnscrollableSheet)

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

/** A recent's own subtitle, with how long ago it happened appended. */
function recentSubtitle(subtitle: string | null | undefined, at: number): string {
  return [subtitle, at && dayjs(at).fromNow()].filter(Boolean).join(' · ')
}
</script>

<template>
  <!-- min-h-full + shrink-0, never h-full: the sheet is a flex column, so a
       shrinkable child gets squeezed back to the sheet's height while the list
       grows past it. The content then spills out of its own box and every
       trailing padding lands above the last card instead of below it. -->
  <div ref="rootEl" class="flex flex-col min-h-full shrink-0 pb-6">
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
        <SectionHeader size="lg" :title="t('library.title')" class="mb-1.5 px-1" />

        <div class="grid grid-cols-2 gap-2">
          <Card
            v-for="tab in libraryTabs"
            :key="tab.id"
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border"
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
        <SectionHeader size="lg" :title="t('navigation.title')" class="mb-1.5 px-1" />
        <div class="grid grid-cols-2 gap-2">
          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border"
            @click="navigateTo('/directions')"
          >
            <ItemIcon icon="Navigation" color="forest" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('directions.title') }}</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border"
            @click="navigateTo('/lookout')"
          >
            <ItemIcon icon="Telescope" color="violet" size="sm" variant="ghost" />
            <span class="font-medium text-sm">Lookout</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border"
            @click="navigateTo('/timeline')"
          >
            <ItemIcon icon="History" color="amber" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('timeline.title') }}</span>
          </Card>

          <Card
            class="p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors cursor-pointer border"
            @click="navigateTo('/settings')"
          >
            <ItemIcon icon="Settings" color="parchment" size="sm" variant="ghost" />
            <span class="font-medium text-sm">{{ t('settings.title') }}</span>
          </Card>
        </div>
      </div>

      <!-- Recent searches and viewed places, interleaved newest-first -->
      <div v-if="recentItems.length > 0">
        <SectionHeader size="lg" :title="t('general.recents')" class="mb-1.5 px-1" />
        <div class="space-y-2">
          <PlaceCard
            v-for="item in visibleRecents"
            :key="item.key"
            :display="item.display"
            variant="row"
            size="sm"
            icon-variant="ghost"
            :subtitle="item.subtitle"
            @click="minimizeSheet()"
          />
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
