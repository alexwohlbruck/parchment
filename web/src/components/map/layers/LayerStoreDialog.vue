<script setup lang="ts">
/**
 * The layer store: the pre-defined bundles a user can put in their library.
 *
 * Every system bundle is listed, added or not, so this doubles as the way back
 * from a deletion — there is no "restore defaults" any more, you just add the
 * bundle again. The grid browses; a card opens that bundle's page, which spells
 * out exactly which layers it brings.
 */
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '@/stores/layers.store'
import type { LayerStoreItem } from '@/lib/layer-templates'
import { useAppService } from '@/services/app.service'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import LayerStoreCard from './LayerStoreCard.vue'
import LayerStoreDetail from './LayerStoreDetail.vue'
import { Button } from '@/components/ui/button'
import { ChevronLeftIcon } from 'lucide-vue-next'

const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()
const layersStore = useLayersStore()
const appService = useAppService()
const { layerStoreItems } = storeToRefs(layersStore)

// Which rows are mid-flight, so a double tap can't add a bundle twice.
const adding = ref(new Set<string>())

/** The bundle being viewed, or null for the grid. */
const selectedId = ref<string | null>(null)

// Track the id rather than the item so the detail view follows the store as it
// changes — otherwise adding from the detail page would leave a stale snapshot
// still offering an Add button.
const selected = computed<LayerStoreItem | null>(
  () =>
    layerStoreItems.value.find(i => i.templateId === selectedId.value) ?? null,
)

const availableCount = computed(
  () => layerStoreItems.value.filter(item => !item.added).length,
)

// Reopening the store should land on the grid, not wherever it was left.
watch(
  () => props.open,
  open => {
    if (!open) selectedId.value = null
  },
)

async function add(item: LayerStoreItem) {
  if (item.added || adding.value.has(item.templateId)) return
  adding.value = new Set(adding.value).add(item.templateId)
  try {
    await layersStore.addStoreItem(item)
    appService.toast.success(t('layers.store.added', { name: item.name }))
  } finally {
    const next = new Set(adding.value)
    next.delete(item.templateId)
    adding.value = next
  }
}
</script>

<template>
  <ResponsiveDialog
    :open="open"
    @update:open="value => emit('update:open', value)"
    :title="selected ? selected.name : t('layers.store.title')"
    :description="selected ? undefined : t('layers.store.description')"
    content-class="sm:max-w-2xl"
  >
    <template #content>
      <!-- Bundle page -->
      <div v-if="selected" class="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 h-7 px-2 text-muted-foreground"
          @click="selectedId = null"
        >
          <ChevronLeftIcon class="size-4" />
          {{ t('layers.store.back') }}
        </Button>

        <div class="max-h-[60vh] overflow-y-auto -mx-1 px-1">
          <LayerStoreDetail
            :item="selected"
            :adding="adding.has(selected.templateId)"
            @add="add(selected!)"
          />
        </div>
      </div>

      <!-- Grid -->
      <div v-else class="max-h-[60vh] overflow-y-auto -mx-1 px-1">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <LayerStoreCard
            v-for="item in layerStoreItems"
            :key="item.templateId"
            :item="item"
            :adding="adding.has(item.templateId)"
            @open="selectedId = item.templateId"
            @add="add(item)"
          />
        </div>

        <p
          v-if="!layerStoreItems.length"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          {{ t('layers.store.empty') }}
        </p>
        <p
          v-else-if="!availableCount"
          class="pt-4 text-center text-xs text-muted-foreground"
        >
          {{ t('layers.store.allAdded') }}
        </p>
      </div>
    </template>
  </ResponsiveDialog>
</template>
