<script setup lang="ts">
import { ref } from 'vue'
import { cn } from '@/lib/utils'
import { useSidebar } from './context'

/**
 * The hit strip along the sidebar's outer edge: drag it to size the panel,
 * click it to collapse or expand. Collapsed, it is the main way back — it
 * lights up under the cursor where the panel ends, which is where people
 * already reach to drag a sidebar open.
 */
const props = defineProps<{ label: string; class?: string }>()

const { collapsed, resizing, toggle, startResize } = useSidebar()

// A press that turns into a drag must not also toggle. The pointer path
// decides for itself; `click` is left to handle keyboard activation, which
// never goes through pointerdown.
const fromPointer = ref(false)

async function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  fromPointer.value = true
  const dragged = await startResize(event)
  if (!dragged) toggle()
  setTimeout(() => (fromPointer.value = false))
}

function onClick() {
  if (fromPointer.value) return
  toggle()
}
</script>

<template>
  <button
    type="button"
    :aria-label="props.label"
    :title="props.label"
    :aria-expanded="!collapsed"
    :class="
      cn(
        'group absolute inset-y-0 right-0 z-20 w-2.5 cursor-col-resize touch-none',
        'focus-visible:outline-hidden',
        props.class,
      )
    "
    @pointerdown="onPointerDown"
    @click="onClick"
  >
    <span
      aria-hidden="true"
      class="absolute inset-y-0 right-0 w-0.5 bg-primary/60 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      :class="resizing ? 'opacity-100' : 'opacity-0'"
    />
  </button>
</template>
