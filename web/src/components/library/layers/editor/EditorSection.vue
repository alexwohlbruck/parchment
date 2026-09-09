<script setup lang="ts">
/**
 * A collapsible block in the editor. Sections keep the sidebar navigable —
 * a symbol layer has forty-odd properties, and showing them all at once
 * turns the panel into a wall.
 */
import { ref } from 'vue'
import { ChevronRightIcon } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    title: string
    /** Shown next to the title — usually how many properties are set. */
    badge?: string | number
    open?: boolean
  }>(),
  { open: false },
)

const isOpen = ref(props.open)
</script>

<template>
  <div class="border rounded-lg overflow-hidden">
    <button
      class="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/40 transition-colors"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <ChevronRightIcon
        class="size-3.5 text-muted-foreground transition-transform duration-150"
        :class="isOpen && 'rotate-90'"
      />
      <span class="text-sm font-medium flex-1">{{ title }}</span>
      <span
        v-if="badge"
        class="text-[11px] text-muted-foreground tabular-nums"
      >
        {{ badge }}
      </span>
    </button>

    <div v-if="isOpen" class="px-3 pb-2 pt-0.5 border-t">
      <slot />
    </div>
  </div>
</template>
