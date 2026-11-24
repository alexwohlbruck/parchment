<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ItemRow } from '@/components/ui/item-row'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import PickNumber from './PickNumber.vue'

export interface PickItem {
  id: string
  title: string
  detail?: string
  /** Place category, which colours its number like the map's badge. */
  category: string
  walkSeconds: number
}

defineProps<{
  items: PickItem[]
  loading?: boolean
  /** The item being acted on; the rest are held off until it settles. */
  busy?: string | null
  /** Shown when there is nothing to list. */
  empty: string
}>()
defineEmits<{ pick: [item: PickItem] }>()
const { t } = useI18n()

const minutes = (item: PickItem) => Math.max(1, Math.round(item.walkSeconds / 60))
</script>

<template>
  <div v-if="loading" class="space-y-1">
    <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-2 py-3">
      <Skeleton class="size-7 rounded-full" />
      <div class="flex-1 space-y-1.5">
        <Skeleton class="h-3.5 w-2/5" />
        <Skeleton class="h-3 w-1/4" />
      </div>
      <Skeleton class="h-5 w-12" />
    </div>
  </div>
  <p v-else-if="!items.length" class="py-6 text-center text-sm text-muted-foreground">{{ empty }}</p>
  <ol v-else class="-mx-2">
    <li v-for="(item, i) in items" :key="item.id">
      <ItemRow
        as="button"
        type="button"
        variant="plain"
        size="md"
        class="rounded-2xl"
        interactive
        :has-details="!!item.detail"
        :title="item.title"
        :disabled="busy != null"
        :class="busy != null && busy !== item.id && 'opacity-50'"
        @click="$emit('pick', item)"
      >
        <template #icon>
          <PickNumber :n="i + 1" :category="item.category" />
        </template>
        <template v-if="item.detail" #details="{ detailClass }">
          <span class="truncate text-muted-foreground" :class="detailClass">{{ item.detail }}</span>
        </template>
        <template #trailing>
          <Spinner v-if="busy === item.id" class="size-5 shrink-0" />
          <div v-else class="shrink-0 text-right leading-tight">
            <div class="text-base font-semibold tabular-nums">{{ t('guidance.pick.minutes', { n: minutes(item) }) }}</div>
            <div class="text-xs text-muted-foreground">{{ t('guidance.pick.walk') }}</div>
          </div>
        </template>
      </ItemRow>
    </li>
  </ol>
</template>
