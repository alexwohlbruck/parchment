<script setup lang="ts">
/**
 * A bundle's page in the store: what it is, and exactly which layers it puts
 * in the library. Layers are listed under their subgroup where the bundle has
 * one, so the list matches the shape it will take in the library.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LayerStoreItem } from '@/lib/layer-templates'
import { ItemIcon } from '@/components/ui/item-icon'
import { Button } from '@/components/ui/button'
import { CheckIcon, PlusIcon } from 'lucide-vue-next'

const props = defineProps<{
  item: LayerStoreItem
  adding?: boolean
}>()

const emit = defineEmits<{ add: [] }>()

const { t } = useI18n()

/**
 * Layers grouped by their subgroup, preserving template order. Bundles with no
 * subgroups come back as a single unnamed section, which renders as a plain
 * list.
 */
const sections = computed(() => {
  const bySection = new Map<string, typeof props.item.layers>()
  for (const layer of props.item.layers) {
    const key = layer.groupName ?? ''
    const list = bySection.get(key)
    if (list) list.push(layer)
    else bySection.set(key, [layer])
  }
  return [...bySection].map(([name, layers]) => ({ name, layers }))
})
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-start gap-3">
      <ItemIcon :icon="item.icon ?? 'Layers3Icon'" size="lg" variant="ghost" />
      <div class="flex-1 min-w-0 pt-0.5">
        <h3 class="text-base font-semibold leading-tight">{{ item.name }}</h3>
        <p v-if="item.description" class="mt-1 text-sm text-muted-foreground">
          {{ item.description }}
        </p>
      </div>
      <Button
        v-if="!item.added"
        size="sm"
        class="shrink-0"
        :disabled="adding"
        @click="emit('add')"
      >
        <PlusIcon class="size-3.5" />
        {{ t('layers.store.add') }}
      </Button>
      <span
        v-else
        class="flex shrink-0 items-center gap-1 pt-1.5 text-xs text-muted-foreground"
      >
        <CheckIcon class="size-3.5" />
        {{ t('layers.store.inLibrary') }}
      </span>
    </div>

    <!-- Contents -->
    <div class="space-y-3">
      <p class="text-xs font-medium text-muted-foreground">
        {{ t('layers.store.includes', item.layers.length) }}
      </p>

      <div
        v-for="section in sections"
        :key="section.name || 'ungrouped'"
        class="space-y-1"
      >
        <p
          v-if="section.name"
          class="text-xs text-muted-foreground/80 pl-0.5"
        >
          {{ section.name }}
        </p>
        <ul class="rounded-lg border divide-y divide-border/60 overflow-hidden">
          <li
            v-for="layer in section.layers"
            :key="layer.templateId"
            class="flex items-center gap-2.5 px-3 py-2"
          >
            <ItemIcon
              :icon="layer.icon ?? 'Layers3Icon'"
              size="xs"
              plain
              class="text-muted-foreground"
            />
            <span class="text-sm truncate">{{ layer.name }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
