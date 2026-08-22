<script setup lang="ts">
/**
 * One layer in a canvas's stack. What the row can offer depends on the kind:
 * a style layer is editable, a borrowed library layer is not (it belongs to
 * the library), and a collection layer's places live elsewhere entirely.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { ItemIcon } from '@/components/ui/item-icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { useLayersStore } from '@/stores/layers.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import type { ThemeColor } from '@/lib/utils'
import type { CanvasLayer } from '@/types/canvas.types'

const props = defineProps<{ layer: CanvasLayer }>()

const emit = defineEmits<{
  toggle: [visible: boolean]
  edit: []
  remove: []
}>()

const { t } = useI18n()
const layersStore = useLayersStore()
const collectionsStore = useCollectionsStore()
const { layers } = storeToRefs(layersStore)
const { collections } = storeToRefs(collectionsStore)

/** Borrowed layers and collections show whatever their source is called now. */
const resolved = computed(() => {
  // Bound to a local so the discriminant narrowing survives into the
  // callbacks below — TypeScript drops it across a closure on `props`.
  const layer = props.layer
  if (layer.kind === 'library') {
    const source = layers.value.find(l => l.id === layer.layerId)
    return {
      name: source?.name ?? t('canvases.layers.missing'),
      icon: source?.icon ?? 'Layers3Icon',
      color: 'cobalt' as ThemeColor,
      missing: !source,
    }
  }
  if (layer.kind === 'collection') {
    const source = collections.value.find(c => c.id === layer.collectionId)
    return {
      name: source?.name ?? t('canvases.layers.missing'),
      icon: layer.icon ?? source?.icon ?? 'BookmarkIcon',
      color: (layer.iconColor ?? source?.iconColor ?? 'coral') as ThemeColor,
      missing: !source,
    }
  }
  return {
    name: layer.name,
    icon: layer.icon ?? 'Layers3Icon',
    color: 'iris' as ThemeColor,
    missing: false,
  }
})

const kindLabel = computed(() => t(`canvases.layers.kinds.${props.layer.kind}`))
</script>

<template>
  <div
    class="group flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-card"
    :class="!layer.visible && 'opacity-60'"
  >
    <GripVerticalIcon
      class="size-3.5 shrink-0 text-muted-foreground/60 cursor-grab canvas-layer-handle"
    />

    <ItemIcon
      :icon="resolved.icon"
      :color="resolved.color"
      size="xs"
      :variant="resolved.missing ? 'ghost' : 'solid'"
    />

    <div class="min-w-0 flex-1">
      <p class="text-sm truncate" :class="resolved.missing && 'italic text-muted-foreground'">
        {{ resolved.name }}
      </p>
      <p class="text-[11px] text-muted-foreground">{{ kindLabel }}</p>
    </div>

    <Button
      variant="ghost"
      size="icon"
      class="size-7 shrink-0"
      :title="t(layer.visible ? 'canvases.layers.hide' : 'canvases.layers.show')"
      :aria-label="t(layer.visible ? 'canvases.layers.hide' : 'canvases.layers.show')"
      @click="emit('toggle', !layer.visible)"
    >
      <EyeIcon v-if="layer.visible" class="size-3.5" />
      <EyeOffIcon v-else class="size-3.5 text-muted-foreground" />
    </Button>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" class="size-7 shrink-0">
          <MoreHorizontalIcon class="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem v-if="layer.kind === 'style'" @click="emit('edit')">
          <PencilIcon class="size-3.5" />
          {{ t('canvases.layers.edit') }}
        </DropdownMenuItem>
        <DropdownMenuItem class="text-destructive" @click="emit('remove')">
          <Trash2Icon class="size-3.5" />
          {{ t('canvases.layers.remove') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
