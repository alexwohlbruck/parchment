<script setup lang="ts">
import { XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { BottomSheet } from '@/components/sheet'
import { useResponsive } from '@/lib/utils'
import { onUnmounted, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { useMapToolsStore } from '@/stores/map-tools.store'

/**
 * The panel every map measuring tool sits in: a card floating over the map on
 * a wide screen, and on a phone a sheet sized to its content, swiped away to
 * close the tool.
 */
defineProps<{
  title: string
  closeLabel: string
  /** Panel width. Measure and Radius size to content; Isochrone is fixed. */
  widthClass?: string
}>()

const emit = defineEmits<{ close: [] }>()

const { isMobileScreen } = useResponsive()
const mapToolsStore = useMapToolsStore()

/** The drag handle's strip above the content, which the sheet also covers. */
const HANDLE_HEIGHT = 16
const sheetContent = ref<HTMLElement | null>(null)
const { height } = useElementSize(sheetContent, undefined, { box: 'border-box' })
watch(
  height,
  value => (mapToolsStore.sheetHeight = value ? Math.round(value) + HANDLE_HEIGHT : 0),
  { immediate: true },
)
onUnmounted(() => (mapToolsStore.sheetHeight = 0))
</script>

<template>
  <BottomSheet
    v-if="isMobileScreen"
    fit-content
    dismissable
    show-drag-handle
    obstructing-key="map-tool-sheet"
    @update:open="open => !open && emit('close')"
  >
    <div ref="sheetContent" class="flex flex-col gap-3 px-4 pb-4 pt-5">
      <div class="flex items-center justify-between gap-2">
        <h2
          class="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]"
        >
          {{ title }}
          <slot name="title-adornment" />
        </h2>
        <div class="-mr-2 flex items-center gap-1">
          <slot name="header-actions" />
          <Button
            variant="ghost"
            size="icon"
            class="size-9 shrink-0"
            :aria-label="closeLabel"
            @click="emit('close')"
          >
            <XIcon class="size-5" />
          </Button>
        </div>
      </div>
      <slot />
    </div>
  </BottomSheet>

  <div v-else class="pointer-events-auto shrink-0" :class="widthClass ?? 'max-w-96'">
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
        <div class="-my-1 -mr-2 flex items-center gap-1">
          <slot name="header-actions" />
          <Button
            variant="ghost"
            size="icon"
            class="size-7 shrink-0"
            :aria-label="closeLabel"
            @click="emit('close')"
          >
            <XIcon class="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent class="flex flex-col gap-3 px-3.5 pb-3 pt-0">
        <slot />
      </CardContent>
    </Card>
  </div>
</template>
