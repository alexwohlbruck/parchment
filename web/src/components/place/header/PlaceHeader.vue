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
import { ItemIcon } from '@/components/ui/item-icon'
import {
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultCategory,
} from '@/lib/search.utils'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { getLocalDayAndTime } from '@/lib/place-open.utils'
import { useGeolocationService } from '@/services/geolocation.service'
import { useUnits } from '@/composables/useUnits'

const props = defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const router = useRouter()
const geo = useGeolocationService()
const { formatDistance } = useUnits()

const placeIconName = computed(() =>
  props.place ? getSearchResultIconName(props.place as Place) : 'MapPin',
)
const placeIconPack = computed(() =>
  props.place
    ? getSearchResultIconPack(props.place as Place)
    : ('lucide' as const),
)
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

function formatTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour = hours % 12 || 12
  if (minutes === 0) return `${hour} ${period}`
  return `${hour}:${minutes.toString().padStart(2, '0')} ${period}`
}

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

  if (hours.isPermanentlyClosed) {
    return { statusText: t('place.hours.permanentlyClosed'), detail: null, isOpen: false }
  }
  if (hours.isTemporarilyClosed) {
    return { statusText: t('place.hours.temporarilyClosed'), detail: null, isOpen: false }
  }
  if (hours.isOpen24_7) {
    return { statusText: t('place.hours.open247'), detail: null, isOpen: true }
  }
  if (!hours.regularHours?.length) return null

  const { day: currentDay, time: currentTime } = getLocalDayAndTime(props.place.timezone)
  const todayHours = hours.regularHours.find((h: any) => h.day === currentDay)

  if (!todayHours) {
    return { statusText: t('place.hours.closedToday'), detail: null, isOpen: false }
  }
  if (currentTime >= todayHours.open && currentTime <= todayHours.close) {
    return {
      statusText: t('place.hours.openNow'),
      detail: t('place.hours.closesAt', { time: formatTime(todayHours.close) }),
      isOpen: true,
    }
  }
  if (currentTime < todayHours.open) {
    return {
      statusText: t('place.hours.opensAt', { time: formatTime(todayHours.open) }),
      detail: null,
      isOpen: false,
    }
  }
  return { statusText: t('place.hours.closed'), detail: null, isOpen: false }
})

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
        <ItemIcon
          :icon="placeIconName"
          :icon-pack="placeIconPack"
          :custom-color="placeCategoryColor"
          size="xs"
          variant="solid"
          shape="circle"
          class="!size-5"
        />
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
    <div class="flex items-start gap-3">
      <!-- Brand Logo -->
      <div
        v-if="logoLoading || brandLogo || logoError"
        class="size-12 rounded-lg overflow-hidden border border-border shadow-sm shrink-0"
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
              v-show="brandLogoLoaded"
              :src="brandLogo"
              :alt="(place.name?.value ?? '') + ' logo'"
              class="w-full h-full object-contain bg-white"
              @load="emit('logoLoaded')"
              @error="emit('logoError')"
            />
          </transition>
        </div>
        <div
          v-if="logoError"
          class="w-full h-full flex items-center justify-center bg-muted"
        />
      </div>

      <div class="flex-1 min-w-0">
        <h1 class="text-[28px] leading-[1.05] line-clamp-2">
          {{ displayName }}
        </h1>
      </div>
    </div>

    <!-- Open status -->
    <div v-if="openingStatus" class="flex items-center gap-1.5 text-sm">
      <span
        class="inline-block size-[7px] rounded-full shrink-0"
        :class="openingStatus.isOpen ? 'bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.18)]' : 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]'"
      />
      <span :class="openingStatus.isOpen ? 'text-green-600' : 'text-red-500'" class="font-medium">{{ openingStatus.statusText }}</span>
      <template v-if="openingStatus.detail">
        <span class="text-muted-foreground font-normal">· {{ openingStatus.detail }}</span>
      </template>
      <template v-if="distanceText">
        <span class="text-muted-foreground font-normal">· {{ distanceText }}</span>
      </template>
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
