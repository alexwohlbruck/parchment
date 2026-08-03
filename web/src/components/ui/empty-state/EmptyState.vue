<script setup lang="ts">
import type { Component } from 'vue'

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
withDefaults(
  defineProps<{
    icon?: Component
    title: string
    description?: string
    /**
     * `panel` centres in the available height, for a view that is otherwise
     * empty. `inline` sits compactly inside a list that has other content
     * above it.
     */
    variant?: 'panel' | 'inline'
  }>(),
  { variant: 'panel' },
)
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center"
    :class="variant === 'panel' ? 'py-12 gap-3' : 'py-6 gap-2'"
  >
    <div
      v-if="icon"
      class="flex items-center justify-center rounded-full bg-muted/50"
      :class="variant === 'panel' ? 'size-12' : 'size-9'"
    >
      <component
        :is="icon"
        class="text-muted-foreground"
        :class="variant === 'panel' ? 'size-6' : 'size-4'"
      />
    </div>

    <div class="space-y-0.5">
      <p
        class="font-semibold text-foreground"
        :class="variant === 'panel' ? 'text-base' : 'text-sm'"
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
