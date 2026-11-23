<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SquareParkingIcon, XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

defineProps<{ destination: string | null }>()
defineEmits<{ find: []; dismiss: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2 text-sm">
    <SquareParkingIcon class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate">
      {{ destination ? t('guidance.parking.near', { place: destination }) : t('guidance.parking.nearby') }}
    </span>
    <Button size="sm" class="h-9 shrink-0 rounded-full px-4" @click="$emit('find')">{{ t('guidance.parking.find') }}</Button>
    <Button size="icon" variant="ghost" class="size-9 shrink-0 rounded-full" :aria-label="t('guidance.parking.dismiss')" @click="$emit('dismiss')">
      <XIcon class="size-4" />
    </Button>
  </div>
</template>
