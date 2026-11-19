<script setup lang="ts">
import { LeafIcon } from 'lucide-vue-next'
import { TransitionFade } from '@morev/vue-transitions'
import { Button } from '@/components/ui/button'
import { usePowerStore } from '@/stores/power.store'

const power = usePowerStore()
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
