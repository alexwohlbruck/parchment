<script setup lang="ts">
/**
 * The layer store: the pre-defined bundles a user can put in their library.
 *
 * Every system bundle is listed, added or not, so this doubles as the way back
 * from a deletion — there is no "restore defaults" any more, you just add the
 * bundle again.
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '@/stores/layers.store'
import type { LayerStoreItem } from '@/lib/layer-templates'
import { useAppService } from '@/services/app.service'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { ItemRow } from '@/components/ui/item-row'
import { ItemIcon } from '@/components/ui/item-icon'
import { Button } from '@/components/ui/button'
import { CheckIcon, PlusIcon } from 'lucide-vue-next'

defineProps<{ open?: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()
const layersStore = useLayersStore()
const appService = useAppService()
const { layerStoreItems } = storeToRefs(layersStore)

// Which rows are mid-flight, so a double tap can't add a bundle twice.
const adding = ref(new Set<string>())

const availableCount = computed(
  () => layerStoreItems.value.filter(item => !item.added).length,
)

/**
 * Each bundle with its one-line summary: the blurb, plus how many layers it
 * brings when that's more than the one the name already implies.
 */
const rows = computed(() =>
  layerStoreItems.value.map(item => ({
    ...item,
    detail: [
      item.description,
      item.layerCount > 1 ? t('layers.store.layers', item.layerCount) : '',
    ]
      .filter(Boolean)
      .join(' · '),
  })),
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
    :title="t('layers.store.title')"
    :description="t('layers.store.description')"
    content-class="sm:max-w-lg"
  >
    <template #content>
      <div class="max-h-[60vh] overflow-y-auto -mx-2 px-2 space-y-0.5">
        <ItemRow
          v-for="item in rows"
          :key="item.templateId"
          :title="item.name"
          size="md"
          :has-details="!!item.detail"
        >
          <template #icon="{ size }">
            <ItemIcon
              :icon="item.icon ?? 'Layers3Icon'"
              :size="size"
              variant="ghost"
            />
          </template>

          <template #details="{ detailClass }">
            <p v-if="item.detail" :class="[detailClass, 'text-muted-foreground']">
              {{ item.detail }}
            </p>
          </template>

          <template #trailing>
            <span
              v-if="item.added"
              class="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
            >
              <CheckIcon class="size-3.5" />
              {{ t('layers.store.inLibrary') }}
            </span>
            <Button
              v-else
              size="sm"
              variant="secondary"
              class="shrink-0"
              :disabled="adding.has(item.templateId)"
              @click="add(item)"
            >
              <PlusIcon class="size-3.5" />
              {{ t('layers.store.add') }}
            </Button>
          </template>
        </ItemRow>

        <p
          v-if="!rows.length"
          class="text-sm text-muted-foreground text-center py-8"
        >
          {{ t('layers.store.empty') }}
        </p>
        <p
          v-else-if="!availableCount"
          class="text-xs text-muted-foreground text-center pt-3"
        >
          {{ t('layers.store.allAdded') }}
        </p>
      </div>
    </template>
  </ResponsiveDialog>
</template>
