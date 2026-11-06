<script setup lang="ts">
import { CircleSlashIcon } from 'lucide-vue-next'
import type { AdviceStatus } from '@/lib/directions/trip-advice'

defineProps<{ status: AdviceStatus }>()
</script>

<template>
  <p class="flex min-w-0 items-baseline gap-x-1.5 tabular-nums">
    <span
      v-if="status.word"
      class="inline-flex shrink-0 items-center gap-1 self-center font-semibold"
      :class="status.tone || 'text-foreground'"
    >
      <CircleSlashIcon v-if="status.kind === 'missed' || status.kind === 'gone'" class="size-[1em]" />
      {{ status.word }}
    </span>
    <span v-if="status.details.length" class="truncate text-muted-foreground">
      {{ status.details.join(' · ') }}
    </span>
  </p>
</template>
