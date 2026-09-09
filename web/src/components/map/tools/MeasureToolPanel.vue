<script setup lang="ts">
import { XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

/**
 * The floating panel every map measuring tool sits in — title, close button,
 * and a translucent card that reads over map tiles. The three tools carried
 * identical copies of this shell.
 */
defineProps<{
  title: string
  closeLabel: string
  /** Panel width. Measure and Radius size to content; Isochrone is fixed. */
  widthClass?: string
}>()

defineEmits<{ close: [] }>()
</script>

<template>
  <div class="pointer-events-auto shrink-0" :class="widthClass ?? 'max-w-96'">
    <Card
      class="rounded-xl border-border/60 bg-background/90 backdrop-blur-sm shadow-sm"
    >
      <CardHeader class="flex flex-row items-center justify-between px-3.5 py-2">
        <CardTitle
          class="mb-0 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]"
        >
          {{ title }}
          <slot name="title-adornment" />
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          class="size-7 shrink-0 -my-1 -mr-2"
          :aria-label="closeLabel"
          @click="$emit('close')"
        >
          <XIcon class="size-4" />
        </Button>
      </CardHeader>

      <CardContent class="flex flex-col gap-3 px-3.5 pb-3 pt-0">
        <slot />
      </CardContent>
    </Card>
  </div>
</template>
