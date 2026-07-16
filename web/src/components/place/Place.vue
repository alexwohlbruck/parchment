<script setup lang="ts">
import {
  ref,
  watch,
  computed,
  inject,
  onUnmounted,
  nextTick,
  type Ref,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { LngLat } from 'mapbox-gl'
import { useDirectionsService } from '@/services/directions.service'
import { getPrimaryPhoto, getLogoPhoto } from '@/types/place.types'
import type { Place } from '@/types/place.types'
import { useAppService } from '@/services/app.service'
import { Skeleton } from '@/components/ui/skeleton'

import PlaceHeader from './header/PlaceHeader.vue'
import PlaceGallery from './gallery/PlaceGallery.vue'
import PlaceActions from './actions/PlaceActions.vue'
import PlaceSources from './sources/PlaceSources.vue'
import DetailsList from './details/DetailsList.vue'
import ReviewsSection from './reviews/ReviewsSection.vue'
import PlaceWidgets from './widgets/PlaceWidgets.vue'
import PlaceVisitHistoryWidget from './widgets/PlaceVisitHistoryWidget.vue'
import NearbyCategories from './NearbyCategories.vue'
import SeeAllBrand from './SeeAllBrand.vue'
import PlaceDisplayChips from './PlaceDisplayChips.vue'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHost from './SheetPageHost.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from 'vue-i18n'
import { providePlaceTabs } from '@/composables/usePlaceTabs'
import { useSheetPeek } from '@/composables/useSheetPeek'

const props = defineProps<{
  place: Partial<Place> | null
  loading: boolean
}>()

// The collapsed (peek) detent fits the header + actions + chips — everything
// below is revealed on expand. No-op on desktop / non-dynamic sheets.
const { peekRef } = useSheetPeek()

const router = useRouter()
const { toast } = useAppService()
const directionsService = useDirectionsService()

const imageLoading = ref(false)
const logoLoading = ref(false)
const imageError = ref(false)
const logoError = ref(false)
const placeImageLoaded = ref(false)
const brandLogoLoaded = ref(false)
const currentPhotoIndex = ref(0)

// Reset loading and error states when place changes
watch(
  () => props.place,
  newPlace => {
    if (newPlace) {
      const primaryPhoto = getPrimaryPhoto(newPlace)
      const logoPhoto = getLogoPhoto(newPlace)
      imageLoading.value = !!primaryPhoto && !placeImageLoaded.value
      logoLoading.value = !!logoPhoto && !brandLogoLoaded.value
      imageError.value = false
      logoError.value = false
      placeImageLoaded.value = false
      currentPhotoIndex.value = 0
    }
  },
)

const { t } = useI18n()
const route = useRoute()

const coordinates = computed(() => {
  if (!props.place?.geometry) return null
  return props.place.geometry.value.center
})

// ── Tabs ────────────────────────────────────────────────────────────────────
// Overview + Reviews are built-in; widgets that used to open a full sub-page
// (Related / Visits / Departures) register their own tab at runtime. The
// active tab lives in the URL as `?tab=` so it's shareable; we use `replace`
// so switching tabs doesn't pile up browser-history entries.
const hasReviews = computed(() => (props.place?.reviews?.length ?? 0) > 0)

function setTab(id: string) {
  const tab = id === 'overview' ? undefined : id
  if ((route.query.tab ?? undefined) === tab) return
  router.replace({ query: { ...route.query, tab } })
}

const { tabs: widgetTabs } = providePlaceTabs({ activate: setTab })

const validTabIds = computed(() => [
  'overview',
  ...(hasReviews.value ? ['reviews'] : []),
  ...widgetTabs.value.map((tab) => tab.id),
])
// Falls back to overview when the URL points at a tab that isn't present
// (yet) — a widget-contributed tab appears once its data loads, and a deep
// link activates it automatically as soon as it registers.
const activeTab = computed(() => {
  const q = route.query.tab
  const id = typeof q === 'string' ? q : 'overview'
  return validTabIds.value.includes(id) ? id : 'overview'
})
const showTabs = computed(
  () => hasReviews.value || widgetTabs.value.length > 0,
)

// Opt the sheet into its "chrome bar" while the sticky tab bar is shown: this
// populates `--sheet-sticky-top` (so the tab bar docks below the drag handle /
// nav buttons / safe-area) and fades in an opaque backing under the chrome as
// you scroll. Mirrors the pinned-header pattern in Directions.vue. No-op on
// desktop (LeftSheet doesn't expose the injection).
const sheetChromeBar = inject<Ref<boolean> | null>('sheetChromeBar', null)
watch(
  showTabs,
  (on) => {
    if (sheetChromeBar) sheetChromeBar.value = on
  },
  { immediate: true },
)
onUnmounted(() => {
  if (sheetChromeBar) sheetChromeBar.value = false
})

// ── Sticky tab bar: detect scroll/pinned state + keep the active tab in view ─
const tabBarRef = ref<HTMLElement | null>(null)
// The backing behind the tab row fades in once the bar actually pins.
const stuck = ref(false)
let scrollRootEl: HTMLElement | null = null
let stuckRaf = 0

function findScrollRoot(el: HTMLElement): HTMLElement | null {
  const named = el.closest('[data-sheet-scroll]') as HTMLElement | null
  if (named) return named
  let node = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll') return node
    node = node.parentElement
  }
  return null
}

// Stuck exactly when the bar can rise no higher than its docked line — not
// merely when scrolling begins.
function measureStuck() {
  stuckRaf = 0
  const bar = tabBarRef.value
  if (!bar || !scrollRootEl) return
  const dockTop = parseFloat(getComputedStyle(bar).top) || 0
  const rootTop = scrollRootEl.getBoundingClientRect().top
  stuck.value = bar.getBoundingClientRect().top <= rootTop + dockTop + 0.5
}
function onRootScroll() {
  if (!stuckRaf) stuckRaf = requestAnimationFrame(measureStuck)
}
function attachStuck() {
  detachStuck()
  const bar = tabBarRef.value
  if (!bar) return
  scrollRootEl = findScrollRoot(bar)
  scrollRootEl?.addEventListener('scroll', onRootScroll, { passive: true })
  measureStuck()
}
function detachStuck() {
  if (stuckRaf) {
    cancelAnimationFrame(stuckRaf)
    stuckRaf = 0
  }
  scrollRootEl?.removeEventListener('scroll', onRootScroll)
  scrollRootEl = null
  stuck.value = false
}

watch(
  showTabs,
  async (on) => {
    if (!on) {
      detachStuck()
      return
    }
    await nextTick()
    attachStuck()
  },
  { immediate: true },
)
onUnmounted(detachStuck)

// When the active tab changes, scroll the tab bar so the whole tab is visible.
watch(
  activeTab,
  async () => {
    await nextTick()
    const list = tabBarRef.value?.querySelector(
      '[role="tablist"]',
    ) as HTMLElement | null
    const active = list?.querySelector(
      '[data-state="active"]',
    ) as HTMLElement | null
    if (!list || !active) return
    const target =
      active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2
    list.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  },
  { immediate: true },
)

function sharePlace() {
  const url = window.location.href
  if (navigator.share) {
    try {
      const name = props.place?.name?.value ?? ''
      navigator.share({
        url,
        title: name,
        text: name,
      })
      return
    } catch (err) {
      navigator.clipboard.writeText(url)
      toast.info('Link copied to clipboard')
    }
  }
}

function handleDirectionsClick() {
  if (!coordinates.value) return

  const waypoint = {
    lngLat: new LngLat(coordinates.value.lng, coordinates.value.lat),
    place: props.place,
  }

  directionsService.directionsTo(waypoint)
  router.push({ name: AppRoute.DIRECTIONS })
}

function handleDirectionsFromClick() {
  if (!coordinates.value) return

  const waypoint = {
    lngLat: new LngLat(coordinates.value.lng, coordinates.value.lat),
    place: props.place,
  }

  directionsService.directionsFrom(waypoint)
  router.push({ name: AppRoute.DIRECTIONS })
}

function handlePlaceImageLoad() {
  placeImageLoaded.value = true
  imageLoading.value = false
}

function handleBrandLogoLoad() {
  brandLogoLoaded.value = true
  logoLoading.value = false
}

function handlePlaceImageError() {
  imageError.value = true
  imageLoading.value = false
}

function handleBrandLogoError() {
  logoError.value = true
  logoLoading.value = false
}
</script>

<template>
  <SheetPageHost>
    <PanelLayout>
      <template v-if="place">
        <div class="flex flex-col space-y-3">
          <!-- Peek region: the sheet's collapsed detent fits down to the
               bottom of this wrapper (header + actions). -->
          <div ref="peekRef" class="space-y-3">
            <PlaceHeader
              :place="place"
              @close="router.push({ name: AppRoute.MAP })"
              @logoLoaded="handleBrandLogoLoad"
              @logoError="handleBrandLogoError"
            />

            <PlaceActions
              :place="place"
              @directions="handleDirectionsClick"
              @directionsFrom="handleDirectionsFromClick"
              @share="sharePlace"
            />
          </div>

          <PlaceDisplayChips :place="place" />

          <!-- Skeleton loaders while full data loads -->
          <template v-if="loading">
            <Skeleton
              class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)] h-48 rounded-lg"
            />
            <div class="space-y-3">
              <Skeleton class="h-5 w-3/4" />
              <Skeleton class="h-5 w-1/2" />
              <Skeleton class="h-5 w-2/3" />
            </div>
            <div class="space-y-2">
              <Skeleton class="h-4 w-1/3" />
              <Skeleton class="h-4 w-1/4" />
            </div>
          </template>

          <template v-else>
            <PlaceGallery
              class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)]"
              :place="place"
              @imageLoaded="handlePlaceImageLoad"
              @imageError="handlePlaceImageError"
            />

            <!-- The Overview content is always mounted (force-mount) so the
                 widgets inside it can register their tabs even while another
                 tab is active. The tab bar only appears once there's more than
                 the Overview tab, so sparse places read as a flat layout. -->
            <Tabs
              :model-value="activeTab"
              class="w-full"
              @update:model-value="(v) => setTab(String(v))"
            >
              <template v-if="showTabs">
                <!-- z-20 keeps this above the scrolling content but below the
                     sheet's nav buttons / drag handle (z-22+), so the backing
                     can reach up behind them. -->
                <div
                  ref="tabBarRef"
                  class="sticky z-20 -mx-3"
                  :style="{ top: 'var(--sheet-sticky-top, 3rem)' }"
                >
                  <!-- Solid backing behind the tab row once the bar pins. -->
                  <div
                    class="pointer-events-none absolute inset-x-0 bottom-0 bg-background transition-opacity duration-200 ease-out"
                    :style="{ top: 'calc(-1 * var(--sheet-sticky-top, 3rem))' }"
                    :class="stuck ? 'opacity-100' : 'opacity-0'"
                  />
                  <TabsList
                    variant="linear"
                    class="relative px-3 pt-2 overflow-x-auto scrollbar-hidden"
                  >
                    <TabsTrigger variant="linear" value="overview">
                      {{ t('place.tabs.overview') }}
                    </TabsTrigger>
                    <TabsTrigger
                      v-if="hasReviews"
                      variant="linear"
                      value="reviews"
                      :count="place.reviews?.length ?? null"
                    >
                      {{ t('place.tabs.reviews') }}
                    </TabsTrigger>
                    <TabsTrigger
                      v-for="tab in widgetTabs"
                      :key="tab.id"
                      variant="linear"
                      :value="tab.id"
                    >
                      {{ tab.label }}
                    </TabsTrigger>
                  </TabsList>
                </div>
              </template>

              <TabsContent
                value="overview"
                force-mount
                class="mt-3 space-y-3 data-[state=inactive]:hidden"
              >
                <DetailsList :place="place" />
                <PlaceVisitHistoryWidget :place="place" />
                <PlaceWidgets :place="place" />
                <SeeAllBrand :place="place" />
                <NearbyCategories :place="place" />
              </TabsContent>

              <TabsContent v-if="hasReviews" value="reviews" class="mt-3">
                <ReviewsSection :place="place" expanded />
              </TabsContent>

              <TabsContent
                v-for="tab in widgetTabs"
                :key="tab.id"
                :value="tab.id"
                class="mt-3"
              >
                <component :is="tab.component" v-bind="tab.props" embedded />
              </TabsContent>
            </Tabs>

            <!-- Attribution stays outside the tabs so it's always visible. -->
            <PlaceSources :place="place" />
          </template>
        </div>
      </template>
    </PanelLayout>
  </SheetPageHost>
</template>

<style>
.snap-x::-webkit-scrollbar {
  display: none;
}
.snap-x {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
