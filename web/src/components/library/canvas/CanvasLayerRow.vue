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
  PencilLineIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { useLayersStore } from '@/stores/layers.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useRoutesStore } from '@/stores/library/routes.store'
import type { ThemeColor } from '@/lib/utils'
import type { CanvasLayer } from '@/types/canvas.types'
import { useInlineRename } from '@/composables/useInlineRename'
import { Input } from '@/components/ui/input'

const RENDER_ICONS: Record<string, string> = {
  points: 'CircleDotIcon',
  lines: 'SplineIcon',
  shapes: 'PentagonIcon',
  heatmap: 'FlameIcon',
}

const props = defineProps<{
  layer: CanvasLayer
  /** Shared view: show what's on the canvas, offer nothing to change it. */
  readonly?: boolean
  /** The row the panel is pointed at, and the mark that has the map's halo. */
  selected?: boolean
}>()

const emit = defineEmits<{
  toggle: [visible: boolean]
  edit: []
  remove: []
  select: []
  rename: [name: string]
}>()

const { t } = useI18n()
const layersStore = useLayersStore()
const collectionsStore = useCollectionsStore()
const routesStore = useRoutesStore()
const { layers } = storeToRefs(layersStore)
const { collections } = storeToRefs(collectionsStore)

/**
 * What the row shows.
 *
 * What this canvas calls the layer wins over what its source calls itself:
 * renaming here is this canvas's own word for it, so it survives the source
 * being renamed — or going away.
 */
const resolved = computed(() => {
  const source = borrowed.value
  return { ...source, name: props.layer.name || source.name }
})

/** Borrowed layers and collections show whatever their source is called now. */
const borrowed = computed(() => {
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
  if (layer.kind === 'route') {
    const route = routesStore.getRouteById(layer.routeId)
    return {
      name: route?.name || t('canvases.layers.missing'),
      icon: 'RouteIcon',
      color: 'forest' as ThemeColor,
      missing: !route,
    }
  }
  if (layer.kind === 'people') {
    return {
      name: t('canvases.layers.kinds.people'),
      icon: 'UsersIcon',
      color: 'coral' as ThemeColor,
      missing: false,
    }
  }
  if (layer.kind === 'data') {
    return {
      name: layer.name,
      icon: RENDER_ICONS[layer.render] ?? 'ShapesIcon',
      color: 'teal' as ThemeColor,
      missing: false,
    }
  }
  return {
    name: layer.name,
    icon: layer.icon ?? 'Layers3Icon',
    color: 'iris' as ThemeColor,
    missing: false,
  }
})

/** Style layers open the layer editor; data layers open their own settings. */
const isEditable = computed(
  () => props.layer.kind === 'style' || props.layer.kind === 'data',
)

const {
  renaming,
  draft,
  input: renameField,
  start: startRename,
  commit: commitRename,
  cancel: cancelRename,
  onMenuClose,
} = useInlineRename({
  value: () => resolved.value.name,
  onCommit: name => emit('rename', name),
})

/**
 * The second line. A data layer says what it is and where it came from — an
 * imported file is worth naming, and a drawn one is worth distinguishing from
 * one that arrived as a file.
 */
const subtitle = computed(() => {
  const layer = props.layer
  if (layer.kind !== 'data') return t(`canvases.layers.kinds.${layer.kind}`)
  const parts = [t(`canvases.layers.renders.${layer.render}`)]
  const count = layer.data?.features?.length ?? 0
  parts.push(t('canvases.layers.featureCount', count))
  return parts.join(' · ')
})
</script>

<template>
  <div
    class="group flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-card transition-colors cursor-pointer"
    :class="[
      !layer.visible && 'opacity-60',
      selected && 'border-primary bg-primary/5',
    ]"
    @click="emit('select')"
  >
    <GripVerticalIcon
      v-if="!readonly"
      class="size-3.5 shrink-0 text-muted-foreground/60 cursor-grab canvas-stack-handle"
    />

    <ItemIcon
      :icon="resolved.icon"
      :color="resolved.color"
      size="xs"
      :variant="resolved.missing ? 'ghost' : 'solid'"
    />

    <div class="min-w-0 flex-1">
      <Input
        v-if="renaming"
        ref="renameField"
        v-model="draft"
        class="h-6 text-sm"
        @click.stop
        @blur="commitRename"
        @keydown.enter="commitRename"
        @keydown.esc="cancelRename"
      />
      <!-- The name is the way in to renaming it, and only the name: the box
           hugs the text so the empty half of the row still belongs to the
           card, which is what selects the layer. -->
      <p
        v-else
        class="text-sm truncate inline-block max-w-full align-top"
        :class="[
          resolved.missing && 'italic text-muted-foreground',
          !readonly && 'cursor-text hover:underline decoration-dotted underline-offset-2',
        ]"
        :title="readonly ? undefined : t('canvases.layers.rename')"
        @click.stop="!readonly && startRename()"
      >
        {{ resolved.name }}
      </p>
      <p class="text-[11px] text-muted-foreground truncate">{{ subtitle }}</p>
    </div>

    <Button
      v-if="!readonly"
      variant="ghost"
      size="icon"
      class="size-7 shrink-0"
      :title="t(layer.visible ? 'canvases.layers.hide' : 'canvases.layers.show')"
      :aria-label="t(layer.visible ? 'canvases.layers.hide' : 'canvases.layers.show')"
      @click.stop="emit('toggle', !layer.visible)"
    >
      <EyeIcon v-if="layer.visible" class="size-3.5" />
      <EyeOffIcon v-else class="size-3.5 text-muted-foreground" />
    </Button>

    <DropdownMenu v-if="!readonly">
      <DropdownMenuTrigger as-child @click.stop>
        <Button variant="ghost" size="icon" class="size-7 shrink-0">
          <MoreHorizontalIcon class="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" @close-auto-focus="onMenuClose">
        <DropdownMenuItem @click="startRename">
          <PencilLineIcon class="size-3.5" />
          {{ t('canvases.layers.rename') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="isEditable" @click="emit('edit')">
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
