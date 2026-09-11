<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuickEditService } from '@/services/quick-edit.service'
import BrandLogo from './BrandLogo.vue'
import type { NsiBrand } from '@/types/quick-edit.types'

const props = defineProps<{
  name: string
  presetId: string
}>()

const emit = defineEmits<{
  select: [brand: NsiBrand]
}>()

const { t } = useI18n()
const quickEditService = useQuickEditService()

const brands = ref<NsiBrand[]>([])

let debounce: ReturnType<typeof setTimeout> | undefined
watch(
  () => [props.name, props.presetId] as const,
  ([name, presetId]) => {
    clearTimeout(debounce)
    if (name.trim().length < 2) {
      brands.value = []
      return
    }
    debounce = setTimeout(async () => {
      try {
        brands.value = await quickEditService.searchBrands(name, presetId)
      } catch {
        brands.value = []
      }
    }, 250)
  },
  { immediate: true },
)

onUnmounted(() => clearTimeout(debounce))
</script>

<template>
  <div v-if="brands.length" class="space-y-1">
    <p class="text-xs text-muted-foreground">{{ t('quickEdit.brand.isThis') }}</p>
    <button
      v-for="brand in brands"
      :key="brand.id"
      type="button"
      class="flex w-full items-center gap-2.5 rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:bg-accent"
      @click="emit('select', brand)"
    >
      <BrandLogo :src="brand.logoUrl" :name="brand.name" size="sm" />
      <span class="min-w-0">
        <span class="block truncate text-sm font-medium">{{ brand.name }}</span>
        <span class="block truncate text-xs text-muted-foreground">
          {{ t('quickEdit.brand.addsTags', Object.keys(brand.tags).length) }}
        </span>
      </span>
    </button>
  </div>
</template>
