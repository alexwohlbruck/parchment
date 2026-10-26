<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BikeIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { DockNeed, DockRisk } from '@/lib/guidance/dock-watch'
import type { DockAlternative, StationStatus } from '@/services/guidance/dock-watch.service'

const props = defineProps<{
  need: DockNeed
  name?: string
  station: StationStatus | null
  risk: DockRisk
  alternative: DockAlternative | null
  dismissed: boolean
  switching: boolean
}>()
defineEmits<{ accept: []; dismiss: [] }>()
const { t } = useI18n()

const stationName = computed(() => props.station?.name ?? props.name ?? '')
const count = computed(() => {
  if (!props.station) return null
  const n = props.need === 'dock' ? props.station.docks : props.station.bikes
  return t(`guidance.docks.${props.need === 'dock' ? 'docks' : 'bikes'}`, { n }, n)
})
const warning = computed(() =>
  props.risk === 'ok' ? null : t(`guidance.docks.${props.risk === 'gone' ? 'gone' : 'atRisk'}.${props.need}`, { station: stationName.value }),
)
const offer = computed(() => !!warning.value && !!props.alternative && !props.dismissed)
</script>

<template>
  <div class="text-sm">
    <div class="flex items-center gap-2">
      <BikeIcon class="size-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate" :class="warning && 'font-medium text-amber-600 dark:text-amber-400'">
        {{ warning ?? stationName }}
      </span>
      <span v-if="count && !warning" class="shrink-0 tabular-nums text-muted-foreground">{{ count }}</span>
    </div>
    <div v-if="offer && alternative" class="mt-2 flex gap-2">
      <Button size="sm" class="h-9 flex-1 rounded-full" :disabled="switching" @click="$emit('accept')">
        {{ t('guidance.docks.switchTo', { station: alternative.name }) }}
      </Button>
      <Button size="sm" variant="secondary" class="h-9 rounded-full" @click="$emit('dismiss')">
        {{ t('guidance.docks.keep') }}
      </Button>
    </div>
  </div>
</template>
