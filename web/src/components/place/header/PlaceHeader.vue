<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  StarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from 'lucide-vue-next'
import type { Place } from '@/types/place.types'
import { getLogoPhoto } from '@/types/place.types'
import PlaceCategoryIcon from '@/components/place/PlaceCategoryIcon.vue'
import { getSearchResultCategory } from '@/lib/search.utils'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { resolveOpeningStatus, getTimezoneDifference } from '@/lib/place-open.utils'
import { useGeolocationService } from '@/services/geolocation.service'
import { useUnits } from '@/composables/useUnits'
import {
  usePlaceTransitLines,
  usePlaceTransitLinesContext,
  type StationLine,
} from '@/composables/usePlaceTransitLines'
import RouteBullet from '@/components/transit/RouteBullet.vue'
import { getRouteBulletLabel } from '@/lib/transit'
import { bulletFor, ensureBulletsAt } from '@/services/layers/features/portolan/portolan-bullets'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatClockTime } from '@/lib/time.utils'

const props = defineProps<{
  place: Partial<Place>
}>()

/** Line bullets for transit stations (N Q R W S 1 2 3 7…), published by
 *  the transit departures widget once its data arrives. */
const stationLines = usePlaceTransitLines(computed(() => props.place?.id))
const stationLinesContext = usePlaceTransitLinesContext(computed(() => props.place?.id))

/** A bullet opens its route, the way tapping one does on a transit map —
 *  the same destination the departure board's route header goes to. Only
 *  where the board named its feed: the route detail is keyed by both. */
function openLine(line: StationLine) {
  const feedId = stationLinesContext.value.feedId
  if (!feedId || !line.id) return
  router.push({
    name: AppRoute.TRANSIT_ROUTE,
    params: { feedId, routeId: line.id },
  })
}

/**
 * The bullets the MAP draws for this station's lines.
 *
 * Portolan curates them — a Mexico City numeral sits in a notched square,
 * a line can be recoloured or renamed away from what its feed says — and
 * resolves that while it builds. The panel cannot redo the resolution, so
 * the pyramid publishes it and this reads it, keyed by the place's own
 * coordinates: a station in Brooklyn asks NYC, not Vienna.
 *
 * Absent for anything portolan does not draw, which is most of the world;
 * a bullet with no curated style stays a circle in the feed's colours.
 */
watch(
  () => props.place?.geometry?.value?.center,
  (center) => void ensureBulletsAt(center?.lat, center?.lng),
  { immediate: true },
)

function styleOf(line: StationLine) {
  const center = props.place?.geometry?.value?.center
  return bulletFor(line.id, center?.lat, center?.lng)
}

/** Why a bullet is dimmed, in words — a dimmed chip with no explanation
 *  reads as a rendering bug.
 *
 *  It states the rider's fact, not the board's method: "the N isn't
 *  running now". How far ahead the board looked to know that is our
 *  business, and naming it ("no service in the next 180 minutes") turned
 *  a plain answer into arithmetic the rider has to finish. */
function lineTitle(line: StationLine): string {
  const name = line.longName || line.shortName || ''
  if (!line.inService) {
    return name
      ? t('place.transit.notInServiceNamed', { name })
      : t('place.transit.notInService')
  }
  return stationLinesContext.value.feedId
    ? t('place.transit.openRouteDetail', { name })
    : name
}

const { t, locale } = useI18n()
const themeStore = useThemeStore()
const router = useRouter()
const geo = useGeolocationService()
const { formatDistance } = useUnits()

/** Colours the category label beside the icon; the icon tints itself. */
const placeCategoryColor = computed(() => {
  const category = props.place
    ? getSearchResultCategory(props.place as Place)
    : ('default' as const)
  return getCategoryColor(category, themeStore.isDark)
})

const placeName = computed(() => {
  return props.place?.name?.value || null
})

const displayName = computed(() => {
  return placeName.value || placeType.value || null
})

const showPlaceType = computed(() => {
  return placeName.value && placeType.value
})

const placeType = computed(() => {
  const type = props.place?.placeType?.value
  const geometryTypes = [
    'Point',
    'LineString',
    'Polygon',
    'MultiPolygon',
    'Line',
    'Area',
    'poi',
  ]
  if (!type || geometryTypes.includes(type)) {
    return null
  }
  return type
})

function openCategorySearch() {
  const presetId = props.place?.icon?.presetId
  const typeName = placeType.value
  if (!presetId || !typeName) return

  router.push({
    name: AppRoute.SEARCH_RESULTS,
    query: {
      categoryId: presetId,
      categoryName: typeName,
      ...(props.place?.icon?.category
        ? { categoryIconCategory: props.place.icon.category }
        : {}),
    },
  })
}

const rating = computed(() => props.place?.ratings?.rating?.value || null)
const reviewCount = computed(
  () => props.place?.ratings?.reviewCount?.value || 0,
)
const brandLogo = computed(() => getLogoPhoto(props.place)?.url)
const description = computed(() => props.place?.description?.value || null)

const logoLoading = ref(false)
const logoError = ref(false)
const brandLogoLoaded = ref(false)
const isDescriptionExpanded = ref(false)
const descriptionRef = ref<HTMLElement>()
const showToggleButton = ref(false)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'logoLoaded'): void
  (e: 'logoError'): void
}>()

function handleLogoLoad() {
  brandLogoLoaded.value = true
  logoLoading.value = false
  emit('logoLoaded')
}

function handleLogoError() {
  logoError.value = true
  logoLoading.value = false
  emit('logoError')
}

// A cached <img> can finish loading before Vue attaches the @load listener, so
// confirm completion when the element mounts too — otherwise the logo stays
// hidden behind v-show forever.
function onLogoRef(el: unknown) {
  const img = el as HTMLImageElement | null
  if (img && img.complete && img.naturalWidth > 0) handleLogoLoad()
}

// Reset + show the shimmer whenever a new brand logo URL appears.
watch(
  brandLogo,
  (url) => {
    if (url) {
      brandLogoLoaded.value = false
      logoError.value = false
      logoLoading.value = true
    } else {
      logoLoading.value = false
    }
  },
  { immediate: true },
)

const formatTime = (time: string) =>
  formatClockTime(time, { omitZeroMinutes: true })

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const distanceText = computed(() => {
  const userLoc = geo.lngLat.value
  const placeCenter = props.place?.geometry?.value?.center
  if (!userLoc || !placeCenter) return null
  const meters = haversineMeters(userLoc.lat, userLoc.lng, placeCenter.lat, placeCenter.lng)
  return t('place.hours.distanceAway', { distance: formatDistance(meters) })
})

const openingStatus = computed(() => {
  const hours = props.place?.openingHours?.value
  if (!hours) return null

  // Permanently closed is a property of the place, not of the current moment,
  // so it drops the live open/closed dot rather than reusing the "closed now" one.
  if (hours.isPermanentlyClosed) {
    return {
      statusText: t('place.hours.permanentlyClosed'),
      detail: null,
      isOpen: false,
      isPermanentlyClosed: true,
    }
  }
  if (hours.isTemporarilyClosed) {
    return { statusText: t('place.hours.temporarilyClosed'), detail: null, isOpen: false }
  }
  if (hours.isOpen24_7) {
    return { statusText: t('place.hours.open247'), detail: null, isOpen: true }
  }

  const status = resolveOpeningStatus(hours, props.place.timezone)
  if (!status) return null

  if (status.state === 'open') {
    return {
      statusText: t('place.hours.openNow'),
      detail: t('place.hours.closesAt', { time: formatTime(status.closesAt!) }),
      isOpen: true,
    }
  }
  if (status.state === 'opensLater') {
    return {
      statusText:
        status.opensDay === undefined
          ? t('place.hours.opensAt', { time: formatTime(status.opensAt!) })
          : t('place.hours.opensDay', {
              day: t(`place.hours.days.${status.opensDay}`),
              time: formatTime(status.opensAt!),
            }),
      detail: null,
      isOpen: false,
    }
  }
  return { statusText: t('place.hours.closed'), detail: null, isOpen: false }
})

// Someone reading about a place across the world sees "Open now" against their
// own midnight; the place's clock is what makes that make sense.
const timezoneNotice = computed(() =>
  openingStatus.value && !openingStatus.value.isPermanentlyClosed
    ? getTimezoneDifference(props.place?.timezone, locale.value)
    : null,
)

const checkOverflow = async () => {
  if (!descriptionRef.value || !description.value) return
  await nextTick()
  const element = descriptionRef.value
  const originalMaxHeight = element.style.maxHeight
  element.style.maxHeight = 'none'
  const fullHeight = element.scrollHeight
  element.style.maxHeight = originalMaxHeight
  showToggleButton.value = fullHeight > 128
}

onMounted(() => {
  checkOverflow()
})

watch(
  description,
  () => {
    checkOverflow()
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Category + rating meta line -->
    <div class="flex items-center gap-1.5 flex-wrap">
      <button
        v-if="showPlaceType || (!placeName && displayName)"
        class="inline-flex items-center gap-1.5 rounded-md -mx-0.5 px-0.5 py-0.5 hover:bg-muted transition-colors"
        :class="place?.icon?.presetId ? 'cursor-pointer' : 'cursor-default'"
        @click="openCategorySearch"
      >
        <PlaceCategoryIcon :place="place" />
        <span
          class="text-xs font-semibold"
          :style="{ color: placeCategoryColor }"
        >{{ placeType }}</span>
      </button>

      <template v-if="rating !== null && showPlaceType">
        <span class="size-0.5 rounded-full bg-muted-foreground/50" />
      </template>

      <span v-if="rating !== null" class="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <StarIcon class="size-3 fill-current text-amber-400" />
        {{ (rating * 5).toFixed(1) }}
        <span v-if="reviewCount">&middot; {{ reviewCount.toLocaleString() }}</span>
      </span>
    </div>

    <!-- Place name -->
    <div class="flex items-center gap-3">
      <!-- Brand Logo -->
      <div
        v-if="logoLoading || brandLogo || logoError"
        class="size-12 rounded-lg overflow-hidden border shadow-sm shrink-0"
      >
        <div
          v-if="logoLoading"
          class="w-full h-full bg-muted/50 animate-pulse relative overflow-hidden"
        >
          <div
            class="absolute inset-0 -translate-x-full animate-[shimmer_1s_infinite] bg-linear-to-r from-transparent via-white/10 to-transparent"
          />
        </div>
        <div v-if="brandLogo" class="w-full h-full">
          <transition
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            enter-active-class="transition-opacity duration-200"
          >
            <img
              :ref="onLogoRef"
              v-show="brandLogoLoaded"
              :src="brandLogo"
              :alt="(place.name?.value ?? '') + ' logo'"
              class="w-full h-full object-contain bg-white"
              @load="handleLogoLoad"
              @error="handleLogoError"
            />
          </transition>
        </div>
        <div
          v-if="logoError"
          class="w-full h-full flex items-center justify-center bg-muted"
        />
      </div>

      <div class="flex-1 min-w-0">
        <!-- pb/-mb pair gives Exposure's descenders room inside the
             line-clamp overflow without changing the element's layout height -->
        <h1 class="text-[28px] leading-[1.05] line-clamp-2 pb-[0.2em] -mb-[0.2em]">
          {{ displayName }}
        </h1>
      </div>
    </div>

    <!-- Transit line bullets — every line serving this station across its
         transfer complex, right under the title like Apple Maps -->
    <TooltipProvider :delay-duration="200">
      <div
        v-if="stationLines.length"
        class="flex flex-wrap items-center gap-1"
      >
        <Tooltip v-for="line in stationLines" :key="line.id">
          <TooltipTrigger as-child>
            <component
              :is="stationLinesContext.feedId && line.id ? 'button' : 'span'"
              class="inline-flex"
              :type="stationLinesContext.feedId && line.id ? 'button' : undefined"
              :class="stationLinesContext.feedId && line.id ? 'cursor-pointer' : ''"
              @click="openLine(line)"
            >
              <RouteBullet
                :label="styleOf(line)?.label || getRouteBulletLabel(line, t)"
                :color="styleOf(line)?.color || line.color"
                :shape="styleOf(line)?.shape"
                :text-color="styleOf(line)?.color ? null : line.textColor"
                :title="lineTitle(line)"
                class="transition-opacity"
                :class="[
                  line.inService ? '' : 'opacity-40 saturate-50',
                  stationLinesContext.feedId && line.id
                    ? 'hover:ring-2 ring-offset-1 ring-foreground/20 transition-shadow'
                    : '',
                ]"
              />
            </component>
          </TooltipTrigger>
          <TooltipContent>{{ lineTitle(line) }}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>

    <!-- Open status -->
    <div v-if="openingStatus" class="flex items-center gap-1.5 text-sm">
      <span
        v-if="!openingStatus.isPermanentlyClosed"
        class="inline-block size-[7px] rounded-full shrink-0"
        :class="openingStatus.isOpen ? 'bg-forest-500 shadow-[0_0_0_3px_rgba(90,126,71,0.18)]' : 'bg-coral-500 shadow-[0_0_0_3px_rgba(216,74,0,0.18)]'"
      />
      <span
        class="font-medium"
        :class="openingStatus.isPermanentlyClosed
          ? 'text-muted-foreground'
          : openingStatus.isOpen ? 'text-forest-600' : 'text-coral-500'"
      >{{ openingStatus.statusText }}</span>
      <template v-if="openingStatus.detail">
        <span class="text-muted-foreground font-normal">· {{ openingStatus.detail }}</span>
      </template>
      <template v-if="distanceText">
        <span class="text-muted-foreground font-normal">· {{ distanceText }}</span>
      </template>
    </div>

    <!-- Whose clock these hours are on, when it isn't the reader's -->
    <div v-if="timezoneNotice" class="text-xs text-muted-foreground -mt-1">
      {{ t('place.hours.localTimeNotice', { time: timezoneNotice.localTime, zone: timezoneNotice.label }) }}
    </div>

    <!-- Description Section -->
    <div v-if="description">
      <div
        v-if="!isDescriptionExpanded"
        ref="descriptionRef"
        class="relative overflow-hidden"
        style="max-height: 7rem"
      >
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ description }}
        </p>
        <div
          v-if="showToggleButton"
          class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background md:from-muted to-transparent pointer-events-none"
        />
      </div>

      <div v-else>
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ description }}
        </p>
      </div>

      <button
        v-if="showToggleButton"
        @click="isDescriptionExpanded = !isDescriptionExpanded"
        class="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer"
      >
        <template v-if="isDescriptionExpanded">
          <ChevronUpIcon class="w-3 h-3" />
          {{ t('place.header.showLess') }}
        </template>
        <template v-else>
          <ChevronDownIcon class="w-3 h-3" />
          {{ t('place.header.showMore') }}
        </template>
      </button>
    </div>
  </div>
</template>
