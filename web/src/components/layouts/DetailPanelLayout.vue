<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from 'lucide-vue-next'

/**
 * Sheet layout with a sticky header containing back button, title, and optional actions.
 * Use this for detail views that need navigation.
 */
defineProps<{
  title?: string
  showBackButton?: boolean
}>()

const emit = defineEmits<{
  back: []
}>()
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div
      class="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border/50"
    >
      <div class="flex items-center gap-3 px-4 py-2">
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
          <h1 v-if="title" class="text-lg font-semibold truncate">
            {{ title }}
          </h1>
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

