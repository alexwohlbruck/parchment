<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FlagIcon, NavigationIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { formatClock } from '@/lib/directions/trip-display'
import type { FreeMode } from '@/lib/guidance/free-roam'

defineProps<{ destination: string | null; hasNextLeg: boolean; keepGoing?: FreeMode | null }>()
defineEmits<{ done: []; next: []; keepGoing: [] }>()
const { t } = useI18n()
const arrivedAt = formatClock(new Date())
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-forest-600/10 text-forest-600 dark:text-forest-400">
      <FlagIcon class="size-5" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="truncate text-lg font-semibold">{{ destination ?? t('guidance.arrival.destination') }}</div>
      <div class="text-sm text-muted-foreground">{{ t('guidance.arrival.at', { time: arrivedAt }) }}</div>
    </div>
    <Button v-if="hasNextLeg" class="h-12 rounded-full px-5" @click="$emit('next')">
      <NavigationIcon class="size-4" />
      {{ t('guidance.arrival.nextLeg') }}
    </Button>
    <Button v-else-if="keepGoing" variant="secondary" class="h-12 rounded-full px-5" @click="$emit('keepGoing')">
      {{ t(`guidance.free.keepGoing.${keepGoing}`) }}
    </Button>
    <Button :variant="hasNextLeg ? 'secondary' : 'default'" class="h-12 rounded-full px-6" @click="$emit('done')">
      {{ t('guidance.arrival.done') }}
    </Button>
  </div>
</template>
