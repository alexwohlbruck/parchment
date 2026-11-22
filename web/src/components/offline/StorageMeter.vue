<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatBytes } from '@/lib/offline/format'

export interface StoragePart {
  id: string
  label: string
  bytes: number
  /** A palette colour name, such as `cobalt`. */
  color: string
}

const props = defineProps<{ parts: StoragePart[] }>()

const { locale } = useI18n()
const shown = computed(() => props.parts.filter(p => p.bytes > 0))
const total = computed(() => shown.value.reduce((sum, p) => sum + p.bytes, 0))
const swatch = (p: StoragePart) => ({ background: `var(--color-${p.color}-500)` })
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex h-1.5 gap-px overflow-hidden rounded-full bg-muted">
      <div
        v-for="part in shown"
        :key="part.id"
        class="h-full transition-[flex-grow] duration-300"
        :style="{ ...swatch(part), flexGrow: part.bytes / total, flexBasis: 0 }"
      />
    </div>
    <ul class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      <li v-for="part in shown" :key="part.id" class="flex items-center gap-1.5">
        <span class="size-2 shrink-0 rounded-full" :style="swatch(part)" />
        {{ part.label }}
        <span class="tabular-nums text-foreground/80">{{ formatBytes(part.bytes, locale) }}</span>
      </li>
    </ul>
  </div>
</template>
