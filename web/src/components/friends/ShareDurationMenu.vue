<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ClockIcon, InfinityIcon, SunriseIcon } from 'lucide-vue-next'
import { SHARE_DURATIONS, type ShareDuration } from '@/lib/friends/share-duration'

defineProps<{ disabled?: boolean }>()

const emit = defineEmits<{ select: [duration: ShareDuration] }>()

const { t } = useI18n()

const icons = {
  '1h': ClockIcon,
  '4h': ClockIcon,
  tomorrow: SunriseIcon,
  indefinite: InfinityIcon,
} satisfies Record<ShareDuration, unknown>
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child :disabled="disabled">
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-52" @click.stop>
      <DropdownMenuLabel class="text-xs font-medium text-muted-foreground">
        {{ t('friends.sharing.title') }}
      </DropdownMenuLabel>
      <DropdownMenuItem
        v-for="duration in SHARE_DURATIONS"
        :key="duration"
        :data-duration="duration"
        @select="emit('select', duration)"
      >
        <component :is="icons[duration]" class="size-4" />
        {{ t(`friends.sharing.duration.${duration}`) }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
