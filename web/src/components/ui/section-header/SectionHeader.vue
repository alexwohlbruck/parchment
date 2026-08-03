<script setup lang="ts">
import { ChevronRightIcon } from 'lucide-vue-next'
import type { Component } from 'vue'

/**
 * The muted heading above a section of content, optionally with a leading
 * icon, a count, and — when the whole header opens a fuller view — a chevron.
 *
 * `clickable` is explicit rather than inferred from whether a listener is
 * attached: declaring `select` as an emit removes it from `$attrs`, so a
 * component can't reliably detect its own listeners.
 */
withDefaults(
  defineProps<{
    title: string
    icon?: Component
    /** Rendered in parentheses after the title. */
    count?: number | string
    /** Appends a `+`, for a count that is a floor rather than a total. */
    hasMore?: boolean
    /** Renders as a button with a chevron and emits `select`. */
    clickable?: boolean
    /** `lg` is a page-level section heading; `sm` labels a block within one. */
    size?: 'sm' | 'lg'
  }>(),
  { size: 'sm', clickable: false, hasMore: false },
)

defineEmits<{ select: [] }>()
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="w-full text-left flex items-center justify-between gap-2 group"
    @click="clickable && $emit('select')"
  >
    <h3
      class="flex items-center gap-2 min-w-0"
      :class="
        size === 'lg'
          ? 'text-lg text-foreground'
          : 'text-sm font-semibold text-muted-foreground'
      "
    >
      <component v-if="icon" :is="icon" class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate">
        {{ title }}
        <span v-if="count !== undefined" class="font-normal">
          ({{ count }}{{ hasMore ? '+' : '' }})
        </span>
      </span>
    </h3>

    <slot name="trailing">
      <ChevronRightIcon
        v-if="clickable"
        class="size-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
      />
    </slot>
  </component>
</template>
