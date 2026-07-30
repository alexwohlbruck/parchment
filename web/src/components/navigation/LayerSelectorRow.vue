<script setup lang="ts">
/**
 * One row in the map's layer selector: an icon, a name, an optional count,
 * and a switch. Groups additionally get a disclosure chevron and render their
 * children indented beneath.
 *
 * Recursive — a group's children can themselves be groups.
 */
import { computed } from 'vue'
import { Switch } from '@/components/ui/switch'
import ItemIcon from '@/components/ui/item-icon/ItemIcon.vue'
import { ChevronRightIcon } from 'lucide-vue-next'
import type { SelectorNode } from './layer-selector.types'
import type { ThemeColor } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    node: SelectorNode
    expanded: Set<string>
    depth?: number
  }>(),
  { depth: 0 },
)

const emit = defineEmits<{ toggleExpanded: [id: string] }>()

const hasChildren = computed(() => (props.node.children?.length ?? 0) > 0)
const isExpanded = computed(() => props.expanded.has(props.node.id))

/**
 * A group reads as fully on only when every child is. Partial selections show
 * the switch off but the row highlighted, so "some of this is showing" is
 * visible at a glance without inventing a third switch state.
 */
const partiallyOn = computed(() => {
  const children = props.node.children
  if (!children?.length) return false
  const on = children.filter(c => c.visible).length
  return props.node.visible && on > 0 && on < children.length
})

function onRowClick() {
  if (hasChildren.value) emit('toggleExpanded', props.node.id)
}
</script>

<template>
  <div>
    <div
      class="flex items-center gap-2 rounded-md py-1.5 pr-1 transition-colors"
      :class="[
        hasChildren ? 'cursor-pointer hover:bg-accent/60' : 'cursor-default',
        depth > 0 ? 'pl-2' : 'pl-1',
      ]"
      :style="depth > 0 ? { marginLeft: `${depth * 20}px` } : undefined"
      @click="onRowClick"
    >
      <!-- Disclosure. Leaf rows get an equivalent spacer so every icon in the
           list stays on the same vertical line. -->
      <ChevronRightIcon
        v-if="hasChildren"
        class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
        :class="{ 'rotate-90': isExpanded }"
      />
      <span v-else class="size-3.5 shrink-0" />

      <!-- Saved-places rows carry the collection's own icon and colour, so the
           selector entry matches the dots it controls on the map. Everything
           else renders a plain glyph. `iconColor` is a ThemeColor name, not a
           CSS colour — same binding CollectionCard uses. -->
      <ItemIcon
        :icon="node.icon || 'Layers3'"
        :icon-pack="node.meta?.iconPack ?? 'lucide'"
        :color="(node.meta?.iconColor as ThemeColor) ?? 'cobalt'"
        variant="ghost"
        shape="circle"
        size="xs"
        :plain="!node.meta"
      />

      <span class="min-w-0 flex-1 truncate text-sm">{{ node.name }}</span>

      <span
        v-if="node.count"
        class="shrink-0 text-xs tabular-nums text-muted-foreground"
      >
        {{ node.count }}
      </span>

      <Switch
        :model-value="node.visible"
        :aria-label="node.name"
        :class="{ 'opacity-70': partiallyOn }"
        @click.stop
        @update:model-value="node.onToggle"
      />
    </div>

    <div v-if="hasChildren && isExpanded">
      <LayerSelectorRow
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :expanded="expanded"
        :depth="depth + 1"
        @toggle-expanded="emit('toggleExpanded', $event)"
      />
    </div>
  </div>
</template>
