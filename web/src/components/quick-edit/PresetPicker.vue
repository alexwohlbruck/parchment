<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { SearchIcon } from 'lucide-vue-next'
import { useQuickEditService } from '@/services/quick-edit.service'
import PresetIcon from './PresetIcon.vue'
import type { GeometryType, PresetSearchResult } from '@/types/quick-edit.types'

const props = defineProps<{
  geometry?: GeometryType
}>()

const emit = defineEmits<{
  select: [preset: PresetSearchResult]
}>()

const { t } = useI18n()
const quickEditService = useQuickEditService()

const query = ref('')
const results = ref<PresetSearchResult[]>([])
const searching = ref(false)

let debounce: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
  clearTimeout(debounce)
  if (q.trim().length < 2) {
    results.value = []
    return
  }
  debounce = setTimeout(async () => {
    searching.value = true
    try {
      results.value = await quickEditService.searchPresets(q, props.geometry)
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
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"
        >
          <PresetIcon :icon="preset.icon" size="sm" />
        </span>
        <span class="min-w-0">
          <span class="block truncate font-medium">{{ preset.name }}</span>
          <span class="block truncate text-xs text-muted-foreground">
            {{ Object.entries(preset.tags).map(([k, v]) => `${k}=${v}`).join(' ') }}
          </span>
        </span>
      </button>
    </div>

    <p
      v-else-if="query.trim().length >= 2 && !searching"
      class="px-2 py-4 text-center text-sm text-muted-foreground"
    >
      {{ t('quickEdit.presetSearchEmpty') }}
    </p>
  </div>
</template>
