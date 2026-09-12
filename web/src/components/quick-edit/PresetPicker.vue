<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { SearchIcon } from 'lucide-vue-next'
import { useQuickEditService } from '@/services/quick-edit.service'
import PresetIcon from './PresetIcon.vue'
import BrandLogo from './BrandLogo.vue'
import type {
  BrandChoice,
  GeometryType,
  PresetSummary,
} from '@/types/quick-edit.types'

const props = defineProps<{
  geometry?: GeometryType
}>()

const emit = defineEmits<{
  select: [preset: PresetSummary]
  selectBrand: [choice: BrandChoice]
}>()

const { t } = useI18n()
const quickEditService = useQuickEditService()

const query = ref('')
const results = ref<PresetSummary[]>([])
const brands = ref<BrandChoice[]>([])
const searching = ref(false)

let debounce: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
  clearTimeout(debounce)
  if (q.trim().length < 2) {
    results.value = []
    brands.value = []
    return
  }
  debounce = setTimeout(async () => {
    searching.value = true
    try {
      const response = await quickEditService.searchPresets(q, props.geometry)
      results.value = response.results
      brands.value = response.brands
    } finally {
      searching.value = false
    }
  }, 200)
})

onUnmounted(() => clearTimeout(debounce))
</script>

<template>
  <div class="space-y-2">
    <div class="relative">
      <SearchIcon
        class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        v-model="query"
        :placeholder="t('quickEdit.presetSearchPlaceholder')"
        class="pl-9"
        autofocus
      />
      <Spinner
        v-if="searching"
        class="absolute right-3 top-1/2 size-4 -translate-y-1/2"
      />
    </div>

    <div v-if="results.length" class="space-y-0.5">
      <button
        v-for="preset in results"
        :key="preset.id"
        type="button"
        class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
        @click="emit('select', preset)"
      >
        <PresetIcon :preset="preset" size="sm" />
        <span class="min-w-0">
          <span class="block truncate font-medium">{{ preset.name }}</span>
          <span class="block truncate font-mono text-xs text-muted-foreground">
            {{ Object.entries(preset.tags).map(([k, v]) => `${k}=${v}`).join(' ') }}
          </span>
        </span>
      </button>
    </div>

    <!-- Chains sit below place types: someone typing "cafe" wants the type,
         someone typing "mcdonalds" gets no types at all and lands here. -->
    <div v-if="brands.length" class="space-y-0.5">
      <p class="px-2 pt-1 text-xs text-muted-foreground">
        {{ t('quickEdit.brand.chainsHeading') }}
      </p>
      <button
        v-for="choice in brands"
        :key="choice.brand.id"
        type="button"
        class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
        @click="emit('selectBrand', choice)"
      >
        <BrandLogo
          :src="choice.brand.logoUrl"
          :name="choice.brand.name"
          size="sm"
        />
        <span class="min-w-0">
          <span class="block truncate font-medium">{{ choice.brand.name }}</span>
          <span class="block truncate text-xs text-muted-foreground">
            {{ choice.preset.name }}
          </span>
        </span>
      </button>
    </div>

    <p
      v-else-if="query.trim().length >= 2 && !searching && !results.length"
      class="px-2 py-4 text-center text-sm text-muted-foreground"
    >
      {{ t('quickEdit.presetSearchEmpty') }}
    </p>
  </div>
</template>
