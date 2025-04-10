<script setup lang="ts">
import { ExternalLinkIcon } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'

defineProps<{
  icon: any
  label?: string
  value?: string
  description?: string
  copyValue?: string
  osmUrl?: string
  coordinates?: { lat: number; lng: number } | null
  href?: string
  target?: string
  color?: string
}>()
</script>

<template>
  <div class="flex gap-3 items-center group min-w-0">
    <component
      :is="icon"
      class="size-4 flex-shrink-0"
      :class="color || 'text-muted-foreground'"
    />
    <div class="flex flex-col flex-1 min-w-0">
      <slot>
        <template v-if="value">
          <div :class="[color, { 'text-primary': href }]">
            <div class="truncate">
              <a
                v-if="href"
                :href="href"
                :target="target"
                class="hover:underline"
                rel="noopener noreferrer"
              >
                {{ value }}
              </a>
              <span v-else>{{ value }}</span>
            </div>
          </div>
          <div
            v-if="description"
            class="text-sm text-muted-foreground truncate"
          >
            {{ description }}
          </div>
        </template>
      </slot>
    </div>
    <div
      v-if="copyValue || osmUrl"
      class="flex opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
    >
      <CopyButton
        v-if="copyValue"
        :text="copyValue"
        :message="`${label || 'Value'} copied to clipboard`"
      />
      <a
        v-if="osmUrl"
        :href="
          coordinates
            ? `${osmUrl}#map=19/${coordinates.lat}/${coordinates.lng}`
            : osmUrl
        "
        target="_blank"
        rel="noopener noreferrer"
        class="p-1 hover:bg-muted rounded"
        :title="`View on OpenStreetMap`"
      >
        <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
      </a>
    </div>
  </div>
</template>
