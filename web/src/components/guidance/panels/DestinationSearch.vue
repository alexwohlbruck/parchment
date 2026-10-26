<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { watchDebounced } from '@vueuse/core'
import { SearchIcon } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { PlaceCard } from '@/components/place/card'
import { useAbortController } from '@/composables/useAbortController'
import { useSearchService } from '@/services/search.service'
import { autocompleteToDisplay } from '@/services/place/place-display'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useThemeStore } from '@/stores/theme.store'
import { toast } from '@/lib/toast'
import type { AutocompleteResult } from '@/types/search.types'

const emit = defineEmits<{ done: [] }>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const themeStore = useThemeStore()
const { getAutocompleteSuggestions } = useSearchService()
const { nextSignal } = useAbortController()

const PLACE_TYPES = new Set<AutocompleteResult['type']>(['place', 'bookmark', 'transit_stop'])

const query = ref('')
const results = shallowRef<AutocompleteResult[]>([])
const loading = ref(false)
const going = ref<string | null>(null)

watchDebounced(
  query,
  async value => {
    const position = guidance.progress?.puck.position
    const signal = nextSignal()
    if (!value.trim()) {
      results.value = []
      loading.value = false
      return
    }
    loading.value = true
    const found = await getAutocompleteSuggestions({ query: value, lat: position?.lat, lng: position?.lng }, signal)
    if (signal.aborted) return
    results.value = (found as AutocompleteResult[]).filter(r => PLACE_TYPES.has(r.type) && r.lat != null && r.lng != null)
    loading.value = false
  },
  { debounce: 200 },
)

const searched = computed(() => query.value.trim().length > 0 && !loading.value)

async function go(result: AutocompleteResult) {
  if (result.lat == null || result.lng == null) return
  going.value = result.id
  const placeId = result.type === 'place' ? result.id : undefined
  const started = await guidance.headTo({ label: result.title, location: { lat: result.lat, lng: result.lng }, placeId })
  going.value = null
  if (started) emit('done')
  else toast.error(t('guidance.free.goFailed'))
}
</script>

<template>
  <div class="space-y-3">
    <form class="relative" @submit.prevent>
      <SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="query" class="h-11 rounded-full pl-9" :placeholder="t('guidance.free.searchPlaceholder')" enterkeyhint="search" />
    </form>

    <div v-if="loading" class="py-6 text-center text-sm text-muted-foreground">…</div>
    <div v-else-if="searched && !results.length" class="py-6 text-center text-sm text-muted-foreground">
      {{ t('guidance.free.empty') }}
    </div>
    <ul v-else class="-mx-2 divide-y">
      <li v-for="result in results" :key="result.id">
        <button
          class="flex w-full items-center rounded-xl px-2 py-1 text-left transition-colors hover:bg-muted disabled:opacity-50"
          :disabled="going != null"
          @click="go(result)"
        >
          <PlaceCard
            :display="autocompleteToDisplay(result, { isDark: themeStore.isDark })"
            variant="plain"
            size="sm"
            density="compact"
            icon-variant="ghost"
            :navigate="false"
            class="min-w-0 flex-1"
          />
        </button>
      </li>
    </ul>
  </div>
</template>
