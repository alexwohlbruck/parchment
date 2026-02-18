<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import { StarIcon, XIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { Place } from '@/types/place.types'
import { getLogoPhoto } from '@/types/place.types'
import { useResponsive } from '@/lib/utils'

const props = defineProps<{
  place: Partial<Place>
}>()

const { isMobileScreen } = useResponsive()

const placeName = computed(() => {
  // Return the name if it exists, otherwise return null (don't show title)
  return props.place?.name?.value || null
})

const placeType = computed(() => {
  // Only show place type if we have a name
  if (!props.place?.name?.value) {
    return null
  }
  
  const type = props.place?.placeType?.value
  
  // Filter out geometry types that shouldn't be displayed as place types
  const geometryTypes = ['Point', 'LineString', 'Polygon', 'MultiPolygon', 'Line', 'Area']
  if (!type || geometryTypes.includes(type)) {
    return null
  }
  
  return type
})

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
        <h1 v-if="placeName" class="text-2xl font-semibold line-clamp-2">
          {{ placeName }}
        </h1>
        <div v-if="placeType" class="text-sm text-muted-foreground">
          {{ placeType }}
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

