<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CoffeeIcon,
  DropletIcon,
  FuelIcon,
  SearchIcon,
  SquareParkingIcon,
  ToiletIcon,
  UtensilsIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ItemIcon } from '@/components/ui/item-icon'
import { useAheadSearch } from '@/composables/guidance/useAheadSearch'
import { useGuidanceStore } from '@/stores/guidance.store'
import { AHEAD_CATEGORIES, aheadCategoriesFor, type AheadCategoryKey } from '@/lib/guidance/along-route-categories'
import { bannerDistance, travelModeAt } from '@/lib/guidance/guidance-display'
import { formatDurationCompact } from '@/lib/time-format'
import {
  getSearchResultCategory,
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultName,
} from '@/lib/search/search-result'
import { getCategoryColor } from '@/services/place/place-colors'
import { toast } from '@/lib/toast'
import { useThemeStore } from '@/stores/theme.store'
import type { AheadResult } from '@/services/guidance/route-search.service'

const props = defineProps<{ metric: boolean }>()
const emit = defineEmits<{ done: []; found: [] }>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const themeStore = useThemeStore()
const { results, loading, failed, search } = useAheadSearch()

const ICONS: Record<AheadCategoryKey, unknown> = {
  fuel: FuelIcon,
  charging: ZapIcon,
  coffee: CoffeeIcon,
  food: UtensilsIcon,
  restrooms: ToiletIcon,
  parking: SquareParkingIcon,
  water: DropletIcon,
  bikeRepair: WrenchIcon,
}

const mode = computed(() =>
  guidance.route ? travelModeAt(guidance.route, guidance.progress?.puck.s ?? 0) : 'driving',
)
const categories = computed(() => aheadCategoriesFor(mode.value))
const active = ref<AheadCategoryKey | null>(null)
const query = ref('')
const searched = ref(false)
const adding = ref<string | null>(null)

async function run(params: { query?: string; categories?: string[] }) {
  searched.value = true
  await search(params)
  if (results.value.length) emit('found')
}

function pick(key: AheadCategoryKey) {
  active.value = key
  query.value = ''
  void run({ categories: AHEAD_CATEGORIES[key] })
}

function submit() {
  if (!query.value.trim()) return
  active.value = null
  void run({ query: query.value.trim() })
}

function distance(meters: number) {
  const { value, unit } = bannerDistance(meters, props.metric)
  return t('guidance.ahead.ahead', { distance: `${value} ${t(`guidance.units.${unit}`)}` })
}

function detour(result: AheadResult) {
  if (result.detourSeconds == null) return null
  return result.detourSeconds < 60
    ? t('guidance.ahead.onTheWay')
    : t('guidance.ahead.detour', { duration: formatDurationCompact(result.detourSeconds) })
}

async function add(result: AheadResult) {
  adding.value = result.place.id
  const center = result.place.geometry.value.center
  const added = await guidance.addStop({ label: getSearchResultName(result.place), location: center })
  adding.value = null
  if (added) emit('done')
  else toast.error(t('guidance.ahead.addFailed'))
}
</script>

<template>
  <div class="space-y-3">

    <form class="relative" @submit.prevent="submit">
      <SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="query" class="h-11 rounded-full pl-9" :placeholder="t('guidance.ahead.placeholder')" enterkeyhint="search" />
    </form>

    <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      <Button
        v-for="key in categories"
        :key="key"
        size="sm"
        :variant="active === key ? 'default' : 'secondary'"
        class="h-10 shrink-0 gap-1.5 rounded-full px-4"
        @click="pick(key)"
      >
        <component :is="ICONS[key]" class="size-4" />
        {{ t(`guidance.ahead.categories.${key}`) }}
      </Button>
    </div>

    <div v-if="loading" class="py-6 text-center text-sm text-muted-foreground">…</div>
    <div v-else-if="failed" class="py-6 text-center text-sm text-muted-foreground">{{ t('guidance.ahead.failed') }}</div>
    <div v-else-if="searched && !results.length" class="py-6 text-center text-sm text-muted-foreground">
      {{ t('guidance.ahead.empty') }}
    </div>
    <ol v-else class="divide-y">
      <li v-for="(result, i) in results" :key="result.place.id" class="flex items-center gap-3 py-3">
        <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
          {{ i + 1 }}
        </span>
        <ItemIcon
          :icon="getSearchResultIconName(result.place)"
          :icon-pack="getSearchResultIconPack(result.place)"
          :custom-color="getCategoryColor(getSearchResultCategory(result.place), themeStore.isDark)"
          size="sm"
          variant="solid"
          shape="circle"
          class="shrink-0"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{{ getSearchResultName(result.place) }}</div>
          <div class="text-xs text-muted-foreground tabular-nums">
            {{ distance(result.alongDistance) }}<template v-if="detour(result)"> · {{ detour(result) }}</template>
          </div>
        </div>
        <Button variant="secondary" class="h-10 shrink-0 rounded-full px-4" :disabled="adding != null" @click="add(result)">
          {{ t('guidance.ahead.add') }}
        </Button>
      </li>
    </ol>
  </div>
</template>
