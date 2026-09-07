<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from 'lucide-vue-next'
import { SheetHeader } from '@/components/sheet'

/**
 * Sheet layout with a sticky header containing back button, title, and optional
 * actions. Use this for detail views that need navigation.
 *
 * Like every panel layout this is a plain column that grows with its content —
 * the host sheet owns the scroll surface. See the layout contract in
 * `components/BottomSheet.vue`.
 */
defineProps<{
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
</script>

<template>
  <!-- pt: start content on the header's dock line, never above it — see
       PanelLayout for why a sticky header that gets pushed down covers the
       content after it. -->
  <div class="min-h-full flex flex-col pt-[var(--sheet-sticky-top,0px)]">
    <SheetHeader
      :peek="!!peekHeader"
      :solid="false"
      class="bg-background/80 backdrop-blur-xl border-b border-border/50"
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
    </SheetHeader>

    <!-- Content -->
    <div class="flex-1 pt-2 pb-4">
      <div class="px-4">
        <slot />
      </div>
    </div>
  </div>
</template>
