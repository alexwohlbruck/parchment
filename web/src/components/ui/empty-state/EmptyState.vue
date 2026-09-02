<script setup lang="ts">
import { computed, type Component } from 'vue'

/**
 * "There's nothing here" — one shape for every list, panel and search result
 * in the app.
 *
 * The library had its own version, but it interpolated `library.entities.*`
 * i18n keys and rendered a fixed Add button, so nothing outside the library
 * could use it. Everywhere else hand-rolled, most memorably a 30-line inline
 * SVG magnifying glass in the place list.
 *
 * Actions go in the default slot rather than being props, since they vary from
 * nothing at all to a full button row.
 */
const props = withDefaults(
  defineProps<{
    icon?: Component
    title: string
    description?: string
    /**
     * `panel` centres in the available height, for a view that is otherwise
     * empty. `inline` sits compactly inside a list that has other content
     * above it. `card` is `inline` in a dashed frame, for a section of a page
     * whose other sections are full — it reads as a place something goes
     * rather than as the page having nothing to say.
     */
    variant?: 'panel' | 'inline' | 'card'
  }>(),
  { variant: 'panel' },
)

/** Everything but `panel` is the small treatment; `card` just adds the frame. */
const compact = computed(() => props.variant !== 'panel')

const containerClass = computed(() => {
  if (props.variant === 'panel') return 'py-12 gap-3'
  if (props.variant === 'card')
    return 'rounded-lg border border-dashed px-4 py-6 gap-2'
  return 'py-6 gap-2'
})
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center"
    :class="containerClass"
  >
    <div
      v-if="icon"
      class="flex items-center justify-center rounded-full bg-muted/50"
      :class="compact ? 'size-9' : 'size-12'"
    >
      <component
        :is="icon"
        class="text-muted-foreground"
        :class="compact ? 'size-4' : 'size-6'"
      />
    </div>

    <div class="space-y-0.5">
      <p
        class="font-semibold text-foreground"
        :class="compact ? 'text-sm' : 'text-base'"
      >
        {{ title }}
      </p>
      <p v-if="description" class="text-sm text-muted-foreground">
        {{ description }}
      </p>
    </div>

    <slot />
  </div>
</template>
