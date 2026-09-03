<script setup lang="ts">
/**
 * One bundle in the store grid. The body opens the bundle's detail view; the
 * action at the foot adds it without leaving the grid.
 */
import { useI18n } from 'vue-i18n'
import type { LayerStoreItem } from '@/lib/layer-templates'
import { ItemIcon } from '@/components/ui/item-icon'
// Same surface and hover as every other tile in the app, rather than a
// one-off: see `ui/item-row/scale.ts`.
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { Button } from '@/components/ui/button'
import { CheckIcon, PlusIcon } from 'lucide-vue-next'

defineProps<{
  item: LayerStoreItem
  adding?: boolean
}>()

const emit = defineEmits<{
  open: []
  add: []
}>()

const { t } = useI18n()
</script>

<template>
  <div
    :class="[
      ITEM_ROW_SURFACES.tile,
      'flex flex-col p-3 text-left transition-colors cursor-pointer hover:bg-secondary/40',
    ]"
    role="button"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <div class="flex items-start justify-between gap-2">
      <ItemIcon :icon="item.icon ?? 'Layers3Icon'" size="md" variant="ghost" />
      <CheckIcon v-if="item.added" class="size-4 shrink-0 text-muted-foreground" />
    </div>

    <p class="mt-2.5 text-sm font-medium leading-snug truncate">
      {{ item.name }}
    </p>
    <p class="mt-0.5 text-xs text-muted-foreground line-clamp-2 min-h-8">
      {{ item.description }}
    </p>

    <div class="mt-3 flex items-center justify-between gap-2">
      <span class="text-xs text-muted-foreground tabular-nums">
        {{ t('layers.store.layers', item.layers.length) }}
      </span>
      <Button
        v-if="!item.added"
        size="sm"
        variant="secondary"
        class="h-7 px-2.5 shrink-0"
        :disabled="adding"
        @click.stop="emit('add')"
      >
        <PlusIcon class="size-3.5" />
        {{ t('layers.store.add') }}
      </Button>
      <span v-else class="text-xs text-muted-foreground">
        {{ t('layers.store.inLibrary') }}
      </span>
    </div>
  </div>
</template>
