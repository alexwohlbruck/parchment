<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LeafIcon } from 'lucide-vue-next'
import { TransitionFade } from '@morev/vue-transitions'
import { Button } from '@/components/ui/button'
import { usePowerStore } from '@/stores/power.store'
import { isStronger } from '@/lib/power/power-saver'
import { toast } from '@/lib/toast'

const power = usePowerStore()
const { t } = useI18n()

// The map changing look on its own needs a reason on screen.
watch(
  () => power.fromBattery,
  (next, prev) => {
    if (!isStronger(next, prev) || !isStronger(next, power.choice)) return
    toast(t(`powerSaver.autoOn.${next}`, { percent: Math.round(power.batteryLevel * 100) }), {
      id: 'power-saver-auto',
    })
  },
)
</script>

<template>
  <TransitionFade>
    <Button
      v-if="power.saving"
      as-child
      variant="outline"
      size="icon"
      class="pointer-events-auto"
      :title="$t('powerSaver.indicator')"
      :aria-label="$t('powerSaver.indicator')"
    >
      <RouterLink to="/settings/behavior#battery-saver">
        <LeafIcon class="size-4" />
      </RouterLink>
    </Button>
  </TransitionFade>
</template>
