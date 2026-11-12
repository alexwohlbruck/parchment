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
import type { SelectorNode } from '@/components/map/layers/layer-selector.types'
import type { ThemeColor } from '@/lib/utils'
import { useI18n } from 'vue-i18n'
import LayerAppearancePicker from './LayerAppearancePicker.vue'

const props = withDefaults(
  defineProps<{
    node: SelectorNode
    expanded: Set<string>
    depth?: number
  }>(),
  { depth: 0 },
)

const emit = defineEmits<{ toggleExpanded: [id: string] }>()

const { t } = useI18n()

const hasChildren = computed(() => (props.node.children?.length ?? 0) > 0)
const hasOptions = computed(
  () => (props.node.appearances?.length ?? 0) > 1 || (props.node.filters?.length ?? 0) > 0,
)
const expandable = computed(() => hasChildren.value || hasOptions.value)
const isExpanded = computed(() => props.expanded.has(props.node.id))
const showsOptions = computed(() => hasOptions.value && props.node.visible && isExpanded.value)

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
  if (expandable.value) emit('toggleExpanded', props.node.id)
}
</script>

<template>
  <div>
    <div
      class="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      :class="[
        expandable ? 'cursor-pointer hover:bg-muted/70' : 'cursor-default',
        partiallyOn ? 'bg-primary/[0.06]' : '',
      ]"
      :style="depth > 0 ? { marginLeft: `${depth * 16}px` } : undefined"
      :role="expandable ? 'button' : undefined"
      :tabindex="expandable ? 0 : undefined"
      :aria-expanded="expandable ? isExpanded : undefined"
      @click="onRowClick"
      @keydown.enter.prevent="onRowClick"
      @keydown.space.prevent="onRowClick"
    >
      <!-- Disclosure. Leaf rows get an equivalent spacer so every icon in the
           list stays on the same vertical line. -->
      <ChevronRightIcon
        v-if="expandable"
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
        v-if="hasOptions && node.visible && !isExpanded && node.appearance"
        class="shrink-0 truncate text-xs text-muted-foreground"
      >
        {{ t(node.appearance.name) }}
      </span>

      <span
        v-if="node.count"
        class="shrink-0 text-xs tabular-nums text-muted-foreground"
      >
        {{ node.count }}
      </span>

      <Switch
        :model-value="node.visible"
        :aria-label="node.name"
        class="origin-right scale-[0.82]"
        :class="{ 'opacity-70': partiallyOn }"
        @click.stop
        @update:model-value="node.onToggle"
      />
    </div>

    <div v-if="showsOptions" class="mb-2 ml-[26px] mr-1 mt-0.5 space-y-2">
      <LayerAppearancePicker
        v-if="(node.appearances?.length ?? 0) > 1 && node.appearance"
        :appearances="node.appearances!"
        :selected="node.appearance.id"
        @select="node.onAppearance?.($event)"
      />
      <div v-if="node.filters?.length" class="flex flex-wrap gap-1.5">
        <button
          v-for="filter in node.filters"
          :key="filter.id"
          type="button"
          class="rounded-full border px-2.5 py-0.5 text-xs transition-colors"
          :class="
            filter.visible
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          "
          :aria-pressed="filter.visible"
          @click="filter.onToggle(!filter.visible)"
        >
          {{ filter.name }}
        </button>
      </div>
      <slot name="options" />
    </div>

    <div
      v-if="hasChildren && isExpanded"
      class="ml-[17px] border-l border-border/70 pl-0.5"
    >
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
