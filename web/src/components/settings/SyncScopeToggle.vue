<script setup lang="ts">
import { computed } from 'vue'
import { CloudIcon, SmartphoneIcon } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthStore } from '@/stores/auth.store'
import { useDeviceOnlyStore } from '@/stores/preferences/device-only.store'

const { syncKey } = defineProps<{ syncKey: string }>()

const authStore = useAuthStore()
const deviceOnlyStore = useDeviceOnlyStore()

const scope = computed({
  get: () => (deviceOnlyStore.isDeviceOnly(syncKey) ? 'device' : 'cloud'),
  set: value => deviceOnlyStore.setDeviceOnly(syncKey, value === 'device'),
})
</script>

<template>
  <DropdownMenu v-if="authStore.me">
    <DropdownMenuTrigger
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      :aria-label="scope === 'cloud' ? $t('settings.sync.synced') : $t('settings.sync.deviceOnly')"
      :title="scope === 'cloud' ? $t('settings.sync.synced') : $t('settings.sync.deviceOnly')"
    >
      <CloudIcon v-if="scope === 'cloud'" class="size-3.5" />
      <SmartphoneIcon v-else class="size-3.5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="min-w-48">
      <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
        {{ $t('settings.sync.title') }}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup v-model="scope">
        <DropdownMenuRadioItem value="cloud" class="gap-2">
          <CloudIcon class="size-4" />
          {{ $t('settings.sync.synced') }}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="device" class="gap-2">
          <SmartphoneIcon class="size-4" />
          {{ $t('settings.sync.deviceOnly') }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
