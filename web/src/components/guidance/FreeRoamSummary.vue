<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SearchIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { formatDurationLong } from '@/lib/time-format'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useGuidanceContext } from './context'

defineProps<{ dash?: boolean }>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { exit, metric, openPanel } = useGuidanceContext()

const elapsed = computed(() => formatDurationLong(Math.max(0, guidance.clockMs - guidance.roamStartedAt) / 1000))
const travelled = computed(() => bannerDistance(guidance.travelledMeters, metric.value))
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="min-w-0 flex-1">
      <div class="font-display-heavy leading-none" :class="dash ? 'text-[34px]' : 'text-[28px]'">
        {{ t(`guidance.free.title.${guidance.freeMode}`) }}
      </div>
      <div class="mt-1.5 text-muted-foreground tabular-nums" :class="dash ? 'text-lg' : 'text-[15px]'">
        <template v-if="guidance.progress">
          {{ elapsed }} · {{ travelled.value }} {{ t(`guidance.units.${travelled.unit}`) }}
        </template>
        <template v-else>{{ t('guidance.waitingForLocation') }}</template>
      </div>
    </div>
    <Button
      size="icon"
      variant="secondary"
      class="shrink-0 rounded-full"
      :class="dash ? 'size-14 [&_svg]:size-6' : 'size-12 [&_svg]:size-5'"
      :title="t('guidance.free.whereTo')"
      :aria-label="t('guidance.free.whereTo')"
      @click="openPanel('destination')"
    >
      <SearchIcon />
    </Button>
    <Button
      variant="destructive"
      class="shrink-0 rounded-full"
      :class="dash ? 'h-14 px-7 text-lg' : 'h-12 px-6 text-base'"
      :aria-label="t('guidance.exit')"
      @click="exit"
    >
      {{ t('guidance.exitShort') }}
    </Button>
  </div>
</template>
