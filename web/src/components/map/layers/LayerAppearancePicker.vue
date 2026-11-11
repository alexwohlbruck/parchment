<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LayerAppearance } from '@/lib/map/layer-appearances'

const props = defineProps<{
  appearances: LayerAppearance[]
  selected: string
}>()

const emit = defineEmits<{ select: [id: string] }>()

const { t } = useI18n()

/** The street pattern every preview tile draws its strokes along. */
const PATHS = [
  { d: 'M-5 30 L40 18 L105 26', width: 4 },
  { d: 'M30 -5 L48 47', width: 3 },
  { d: 'M60 -5 C70 15 75 30 105 38', width: 2.5 },
  { d: 'M-5 8 L28 2', width: 3 },
]

const legend = computed(
  () => props.appearances.find(a => a.id === props.selected)?.legend,
)
</script>

<template>
  <div class="space-y-2">
    <div
      class="grid gap-1.5"
      :style="{ gridTemplateColumns: `repeat(${appearances.length}, minmax(0, 1fr))` }"
      role="radiogroup"
    >
      <button
        v-for="appearance in appearances"
        :key="appearance.id"
        type="button"
        role="radio"
        :aria-checked="appearance.id === selected"
        class="overflow-hidden rounded-md border bg-card text-left transition-colors hover:bg-muted/70 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        :class="
          appearance.id === selected
            ? 'border-primary ring-1 ring-primary'
            : 'border-border'
        "
        @click="emit('select', appearance.id)"
      >
        <svg
          viewBox="0 0 100 42"
          preserveAspectRatio="none"
          class="block h-10 w-full bg-muted/50"
          aria-hidden="true"
        >
          <path
            v-for="(stroke, i) in appearance.swatch"
            :key="i"
            :d="PATHS[i % PATHS.length].d"
            :stroke="stroke.color"
            :stroke-width="PATHS[i % PATHS.length].width"
            :stroke-dasharray="stroke.dash"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
        <span class="block truncate px-1.5 py-1 text-center text-xs font-medium">
          {{ t(appearance.name) }}
        </span>
      </button>
    </div>

    <div
      v-if="legend"
      class="flex items-center gap-2 px-0.5 text-[11px] text-muted-foreground"
    >
      <span>{{ t(legend.from) }}</span>
      <span
        class="h-1.5 flex-1 rounded-full"
        :style="{ background: `linear-gradient(90deg, ${legend.colors.join(', ')})` }"
      />
      <span>{{ t(legend.to) }}</span>
    </div>
  </div>
</template>
