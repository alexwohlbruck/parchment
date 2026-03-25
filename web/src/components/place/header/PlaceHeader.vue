<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import { StarIcon, XIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { Place } from '@/types/place.types'
import { getLogoPhoto } from '@/types/place.types'
import { useResponsive } from '@/lib/utils'
import { ItemIcon } from '@/components/ui/item-icon'
import { getSearchResultIconName, getSearchResultIconPack, getSearchResultCategory } from '@/lib/search.utils'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'

const props = defineProps<{
  place: Partial<Place>
}>()

const { isMobileScreen } = useResponsive()
const themeStore = useThemeStore()
const router = useRouter()

const placeIconName = computed(() => props.place ? getSearchResultIconName(props.place as Place) : 'MapPin')
const placeIconPack = computed(() => props.place ? getSearchResultIconPack(props.place as Place) : 'lucide' as const)
const placeCategoryColor = computed(() => {
  const category = props.place ? getSearchResultCategory(props.place as Place) : 'default' as const
  return getCategoryColor(category, themeStore.isDark)
})

const placeName = computed(() => {
  // Return the name if it exists, fall back to place type for unnamed POIs
  return props.place?.name?.value || null
})

// For unnamed places, use the place type as the title
const displayName = computed(() => {
  return placeName.value || placeType.value || null
})

// Only show place type separately when there's a real name (avoid showing it twice)
const showPlaceType = computed(() => {
  return placeName.value && placeType.value
})

const placeType = computed(() => {
  const type = props.place?.placeType?.value

  // Filter out geometry types that shouldn't be displayed as place types
  const geometryTypes = ['Point', 'LineString', 'Polygon', 'MultiPolygon', 'Line', 'Area', 'poi']
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

// Check if description content overflows the max height
const checkOverflow = async () => {
  if (!descriptionRef.value || !description.value) return
  
  await nextTick()
  
  // Temporarily expand to measure full height
  const element = descriptionRef.value
  const originalMaxHeight = element.style.maxHeight
  element.style.maxHeight = 'none'
  
  const fullHeight = element.scrollHeight
  const maxHeight = 128 // 8rem = 128px (assuming 1rem = 16px)
  
  // Restore original max height
  element.style.maxHeight = originalMaxHeight
  
  showToggleButton.value = fullHeight > maxHeight
}

onMounted(() => {
  checkOverflow()
})

// Watch for description changes and recheck overflow
watch(description, () => {
  checkOverflow()
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-start justify-between gap-2">
      <!-- Brand Logo -->
      <div
        v-if="logoLoading || brandLogo || logoError"
        class="size-12 rounded-lg overflow-hidden border border-border shadow-sm shrink-0 mr-2"
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

      <div class="flex-1">
        <h1 v-if="displayName" class="text-2xl font-semibold line-clamp-2">
          {{ displayName }}
        </h1>
        <!-- Named place: show icon + type label as a clickable badge -->
        <button
          v-if="showPlaceType"
          class="flex items-center gap-1.5 group rounded-md -mx-1 px-1 py-0.5 hover:bg-muted transition-colors"
          :class="place?.icon?.presetId ? 'cursor-pointer' : 'cursor-default'"
          @click="openCategorySearch"
        >
          <ItemIcon
            :icon="placeIconName"
            :icon-pack="placeIconPack"
            :custom-color="placeCategoryColor"
            size="sm"
            variant="solid"
            shape="circle"
            class="!size-6"
          />
          <span class="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{{ placeType }}</span>
        </button>
        <!-- Unnamed place: show icon badge only (type is already the title) -->
        <div v-else-if="placeType && !placeName" class="flex items-center gap-1.5">
          <ItemIcon
            :icon="placeIconName"
            :icon-pack="placeIconPack"
            :custom-color="placeCategoryColor"
            size="sm"
            variant="solid"
            shape="circle"
            class="!size-6"
          />
        </div>
        <div v-if="rating !== null" class="flex items-center gap-1 mt-1">
          <div class="flex">
            <StarIcon
              v-for="i in Math.floor(rating * 5)"
              :key="i"
              class="w-3 h-3 fill-current text-yellow-400"
            />
            <StarIcon
              v-for="i in 5 - Math.floor(rating * 5)"
              :key="i + 5"
              class="w-3 h-3 text-muted-foreground"
            />
          </div>
          <span class="text-sm">
            {{ (rating * 5).toFixed(1) }}
            <span class="text-muted-foreground">({{ reviewCount }})</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Description Section -->
    <div v-if="description">
      <!-- Collapsed view with max height -->
      <div 
        v-if="!isDescriptionExpanded"
        ref="descriptionRef"
        class="relative overflow-hidden"
        style="max-height: 7rem"
      >
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ description }}
        </p>
        
        <!-- Fade out gradient (only show when content overflows) -->
        <div 
          v-if="showToggleButton"
          class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background md:from-muted to-transparent pointer-events-none" 
        />
      </div>
      
      <!-- Expanded view -->
      <div v-else>
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ description }}
        </p>
      </div>
      
      <!-- Toggle button (only show if content overflows) -->
      <button
        v-if="showToggleButton"
        @click="isDescriptionExpanded = !isDescriptionExpanded"
        class="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer"
      >
        <template v-if="isDescriptionExpanded">
          <ChevronUpIcon class="w-3 h-3" />
          Show less
        </template>
        <template v-else>
          <ChevronDownIcon class="w-3 h-3" />
          Show more
        </template>
      </button>
    </div>
  </div>
</template>

