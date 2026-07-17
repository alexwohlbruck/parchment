<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SearchIcon } from 'lucide-vue-next'
import { useDebounceFn } from '@vueuse/core'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ItemIcon } from '@/components/ui/item-icon'
import { Spinner } from '@/components/ui/spinner'
import { useSearchService } from '@/services/search.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useMapCamera } from '@/composables/useMapCamera'
import type { AutocompleteResult } from '@/types/search.types'
import type { Place } from '@/types/place.types'
import type { Bookmark } from '@/types/library.types'
import { type ThemeColor } from '@/lib/utils'
import {
  FREQUENT_META,
  CUSTOM_FREQUENT_ICON,
  isCanonicalFrequent,
  deriveExternalIds,
  type FrequentType,
} from '@/lib/frequents'

const props = defineProps<{
  open: boolean
  frequentType: FrequentType
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  set: [bookmark: Bookmark]
}>()

const { t } = useI18n()
const searchService = useSearchService()
const bookmarksService = useBookmarksService()
const mapCamera = useMapCamera()

const query = ref('')
const customName = ref('')
const results = ref<AutocompleteResult[]>([])
const isLoading = ref(false)
const isSaving = ref(false)

const isCustom = computed(() => props.frequentType === 'custom')
const frequentLabel = computed(() => t(`library.types.${props.frequentType}`))

// Header icon: canonical types use their fixed chip; custom uses a star.
const headerIcon = computed(() =>
  isCanonicalFrequent(props.frequentType)
    ? FREQUENT_META[props.frequentType].icon
    : CUSTOM_FREQUENT_ICON,
)
const headerColor = computed<ThemeColor>(() =>
  isCanonicalFrequent(props.frequentType)
    ? FREQUENT_META[props.frequentType].color
    : 'parchment',
)

// Reset each time the dialog opens so a previous search doesn't linger.
watch(
  () => props.open,
  isOpen => {
    if (isOpen) {
      query.value = ''
      customName.value = ''
      results.value = []
      isLoading.value = false
    }
  },
)

const runSearch = useDebounceFn(async (value: string) => {
  if (!value.trim()) {
    results.value = []
    isLoading.value = false
    return
  }
  isLoading.value = true
  try {
    const center = mapCamera.camera.value.center
    const [lng, lat] = Array.isArray(center)
      ? center
      : 'lng' in center
        ? [center.lng, center.lat]
        : [center.lon, center.lat]

    results.value = await searchService.getAutocompleteSuggestions({
      query: value,
      lat,
      lng,
    })
  } finally {
    isLoading.value = false
  }
}, 200)

watch(query, value => {
  runSearch(value)
})

/** Build a Place from an autocomplete result, deriving externalIds from its
 *  id so the created bookmark carries a real provider id (matches the place
 *  detail's ids, so "already saved" detection lights up later). */
function resultToPlace(result: AutocompleteResult): Place {
  // The autocomplete description is "<PlaceType> · <address>" (for the results
  // list); store only the address part so the saved bookmark's address is clean.
  const address = result.description?.includes(' · ')
    ? result.description.slice(result.description.indexOf(' · ') + 3)
    : result.description

  return {
    id: result.id,
    name: { value: result.title },
    geometry: {
      value: {
        type: 'point',
        center: { lat: result.lat, lng: result.lng },
      },
    },
    externalIds: deriveExternalIds(result.id),
    address: address ? { value: { formatted: address } } : null,
    placeType: { value: 'place' },
  } as unknown as Place
}

async function onSelect(result: AutocompleteResult) {
  if (isSaving.value) return
  if (result.type === 'category') return
  isSaving.value = true
  try {
    const place = resultToPlace(result)
    const bookmark = await bookmarksService.setFrequent(place, props.frequentType, {
      name: isCustom.value ? customName.value : undefined,
    })
    if (bookmark) {
      emit('set', bookmark)
      emit('update:open', false)
    }
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      show-close-button
      class="flex flex-col p-4 sm:p-6 h-full sm:h-auto w-full sm:max-w-md sm:max-h-[80vh]"
    >
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ItemIcon
            :icon="headerIcon"
            :color="headerColor"
            size="sm"
            variant="ghost"
          />
          {{
            isCustom
              ? t('dashboard.yourPlaces.setCustomTitle')
              : t('dashboard.yourPlaces.setTitle', { label: frequentLabel })
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            isCustom
              ? t('dashboard.yourPlaces.setCustomDescription')
              : t('dashboard.yourPlaces.setDescription', { label: frequentLabel })
          }}
        </DialogDescription>
      </DialogHeader>

      <!-- Custom frequents are user-named. -->
      <div v-if="isCustom">
        <label class="text-xs text-muted-foreground mb-1 block">
          {{ t('dashboard.yourPlaces.customName') }}
        </label>
        <Input
          v-model="customName"
          :placeholder="t('dashboard.yourPlaces.customNamePlaceholder')"
        />
      </div>

      <div class="relative">
        <SearchIcon
          class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
        />
        <Input
          v-model="query"
          class="w-full pl-8"
          :placeholder="t('dashboard.yourPlaces.searchPlaceholder')"
          :autofocus="!isCustom"
        />
      </div>

      <div class="min-h-[8rem] max-h-[50vh] overflow-y-auto -mx-1 px-1">
        <div v-if="isLoading && results.length === 0" class="flex justify-center py-6">
          <Spinner class="size-4" />
        </div>

        <div
          v-else-if="!query.trim()"
          class="py-6 text-center text-sm text-muted-foreground"
        >
          {{ t('dashboard.yourPlaces.searchHint') }}
        </div>

        <div
          v-else-if="results.length === 0"
          class="py-6 text-center text-sm text-muted-foreground"
        >
          {{ t('dashboard.yourPlaces.noResults') }}
        </div>

        <div v-else class="flex flex-col gap-0.5">
          <button
            v-for="result in results"
            :key="result.id"
            type="button"
            class="w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary/50 transition-colors disabled:opacity-60"
            :disabled="isSaving"
            @click="onSelect(result)"
          >
            <ItemIcon
              :icon="result.icon || 'MapPin'"
              :icon-pack="result.iconPack ?? 'lucide'"
              :color="(result.color as ThemeColor) || 'parchment'"
              size="sm"
              variant="ghost"
              class="shrink-0"
            />
            <div class="flex flex-col min-w-0">
              <span class="text-sm truncate">{{ result.title }}</span>
              <span
                v-if="result.description"
                class="text-xs text-muted-foreground truncate"
              >
                {{ result.description }}
              </span>
            </div>
          </button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
