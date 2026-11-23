<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { ItemIcon } from '@/components/ui/item-icon'

defineProps<{ destination: string | null }>()
defineEmits<{ find: []; dismiss: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-3">
    <ItemIcon icon="SquareParkingIcon" color="cobalt" variant="solid" size="sm" class="shrink-0" />
    <span class="min-w-0 flex-1 truncate text-sm font-medium">
      {{ destination ? t('guidance.parking.near', { place: destination }) : t('guidance.parking.nearby') }}
    </span>
    <Button size="sm" class="h-9 shrink-0 rounded-full px-4" @click="$emit('find')">{{ t('guidance.parking.find') }}</Button>
    <Button size="icon" variant="ghost" class="-mr-1 size-9 shrink-0 rounded-full text-muted-foreground" :aria-label="t('guidance.parking.dismiss')" @click="$emit('dismiss')">
      <XIcon class="size-4" />
    </Button>
  </div>
</template>
