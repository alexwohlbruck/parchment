<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from 'lucide-vue-next'
import { useSheetPeek } from '@/composables/useSheetPeek'

/**
 * Sheet layout with a sticky header containing back button, title, and optional actions.
 * Use this for detail views that need navigation.
 */
const props = defineProps<{
  title?: string
  showBackButton?: boolean
  /**
   * Size the host sheet's collapsed (peek) detent to this header, so a
   * minimized sheet shows exactly the title bar and nothing of the body.
   * No-op outside a dynamic-peek bottom sheet.
   */
  peekHeader?: boolean
}>()

const emit = defineEmits<{
  back: []
}>()

const headerEl = ref<HTMLElement | null>(null)
const { peekRef } = useSheetPeek()
watchEffect(() => {
  peekRef.value = props.peekHeader ? headerEl.value : null
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div
      ref="headerEl"
      class="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border/50"
    >
      <div class="flex items-center gap-3 px-4 py-3">
        <Button
          v-if="showBackButton"
          variant="ghost"
          size="icon"
          class="shrink-0 -ml-2"
          @click="emit('back')"
        >
          <ArrowLeftIcon class="size-5" />
        </Button>

        <div class="flex-1 min-w-0">
          <p v-if="title" class="text-lg font-semibold truncate">
            {{ title }}
          </p>
          <slot name="title" />
        </div>

        <slot name="actions" />
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto pt-2 pb-4">
      <div class="px-4">
        <slot />
      </div>
    </div>
  </div>
</template>

