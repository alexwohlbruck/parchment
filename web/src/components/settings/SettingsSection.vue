<script setup lang="ts">
import { H5 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import SyncScopeToggle from './SyncScopeToggle.vue'

interface Props {
  id?: string
  title?: string
  description?: string
  frame?: boolean
  shadow?: boolean
  class?: string
  /** Preference path every item in the section edits, when it can follow the account. */
  syncKey?: string
}

const {
  shadow = true,
  frame = true,
  class: className = '',
} = defineProps<Props>()
</script>

<template>
  <div
    :id="id"
    data-settings-section
    :data-section-id="id"
    :class="
      cn(
        'flex flex-col gap-3 w-full settings-section-target',
        !frame && 'flex-1 min-h-0',
        className,
      )
    "
  >
    <div
      v-if="title || description"
      class="sticky top-0 z-10 -mx-4 px-4 md:-ml-6 md:pl-6 pt-2 pb-1.5 flex justify-between items-center bg-background border-b"
    >
      <div>
        <div v-if="title" class="flex items-center gap-1.5">
          <H5 class="font-display">{{ title }}</H5>
          <SyncScopeToggle v-if="syncKey" :sync-key="syncKey" />
        </div>
        <Caption v-if="description">{{ description }}</Caption>
      </div>
      <slot name="actions"></slot>
    </div>

    <Card v-if="frame" class="w-full h-full py-3 px-4 flex flex-col gap-4">
      <slot></slot>
    </Card>

    <div v-else class="w-full flex-1 min-h-0 flex flex-col gap-4">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.settings-section-target {
  transition: box-shadow 0.5s ease-out;
}
.settings-section-target.is-flashing {
  box-shadow: 0 0 0 4px rgb(from var(--primary) r g b / 0.18);
  border-radius: var(--radius);
}
</style>
